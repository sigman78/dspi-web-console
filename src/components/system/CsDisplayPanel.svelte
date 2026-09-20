<script lang="ts">
  // I2C display settings + pages editor (caps v10+): one CfgDraft for the
  // display's own settings blob (mode/dwell/overlay/alignment) and up to 16
  // PageDraft rows, one per display page slot. Sibling of CsGroupsPanel/
  // CsMacrosPanel -- same fw dirty flag; save/discard live in the CHANGES
  // panel. No parent of its own so it watches cs.revertEpoch instead of a
  // reset prop. Config/pages are live whether or not a display is attached
  // (fw accepts them in advance); the status row/poll only make sense once a
  // binding is actually running.
  import { tick, untrack } from 'svelte';
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import {
    applyCsDisplayCfg, applyCsDisplayPage, clearCsDisplayPage, refreshCsDisplayStatus,
  } from '@/runtime';
  import * as Domain from '@/domain';
  import { getSession } from '@/components/sessionContext';
  import * as CsField from './csFieldHelpers';
  import * as CsDisplayDraft from './csDisplayDraft';
  import type { CfgDraft, PageDraft } from './csDisplayDraft';

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const cs = $derived(s.controlSurfaces);
  const caps = $derived(s.controlSurfaces.caps);

  // Firmware dropped every saved level-bar page at boot until the caps v17
  // sanitizer fix, so the warning only applies to caps 13-16 devices.
  const barTitle = $derived((caps?.capsVersion ?? 0) >= 17
    ? 'Level bar'
    : 'Level bar. Note: this fw build drops bars on reboot');

  let cfgDraft = $state<CfgDraft | null>(null);
  const pageDrafts = $state<Record<number, PageDraft>>({});
  let applying = $state(false);

  const maxPages = $derived(Math.min(cs.displayLimits?.maxPages ?? 0, Domain.CS_MAX_DISPLAY_PAGES));

  // Which page the single editor below shows -- a view choice, not fw state.
  let selPage = $state(0);
  $effect(() => {
    if (maxPages > 0 && selPage >= maxPages) selPage = maxPages - 1;
  });

  $effect(() => {
    void cs.revertEpoch;   // the ONLY dependency -- cleanup must not track drafts
    untrack(() => {
      cfgDraft = null;
      for (const k of Object.keys(pageDrafts)) delete pageDrafts[Number(k)];
    });
  });

  // A live, active Display binding slot -- from cs.bindings + the activeMask,
  // not displayStatus.initState (which can still read INIT/DOWN in the first
  // 200 ms after attach; the binding itself is already running by then).
  const displaySlotActive = $derived(
    (() => {
      for (let i = 0; i < cs.bindings.length; i++) {
        if (cs.bindings[i]?.type === Domain.CsType.Display && cs.status && (cs.status.activeMask & (1 << i))) return true;
      }
      return false;
    })(),
  );
  const displayBinding = $derived(cs.bindings.find((b) => b?.type === Domain.CsType.Display) ?? null);

  // Live-status poll: while a display binding is active, re-read status every
  // 1 s so the pill/showing line track the front panel. Timeout chain (next
  // tick armed only after the previous read settles), same as the macro
  // panel's running-macro poll.
  $effect(() => {
    if (!displaySlotActive) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      await refreshCsDisplayStatus(s);
      if (!stopped) timer = setTimeout(() => { void tick(); }, 1000);
    };
    timer = setTimeout(() => { void tick(); }, 1000);
    return () => { stopped = true; if (timer != null) clearTimeout(timer); };
  });

  function pill(): { text: string; cls: string } {
    const st = cs.displayStatus;
    const state = st?.initState ?? Domain.CsDisplayInitState.Down;
    if (state === Domain.CsDisplayInitState.Live) return { text: 'LIVE', cls: 'ok' };
    if (state === Domain.CsDisplayInitState.Init) return { text: 'STARTING', cls: 'new' };
    if (state === Domain.CsDisplayInitState.Error) return { text: `ERROR · ${st?.nakCount ?? 0} NAKs`, cls: 'warn' };
    return { text: 'NO DISPLAY', cls: 'off' };
  }

  function modelAddrText(): string {
    const st = cs.displayStatus;
    if (!st || !displayBinding) return '';
    const model = Domain.csDisplayModelInfo(st.model)?.label ?? `Model ${st.model}`;
    const addr = Domain.csDisplayResolvedAddr(st.model, displayBinding.value);
    return `${model} · addr 0x${addr.toString(16).toUpperCase()}`;
  }

  function showingText(): string {
    const st = cs.displayStatus;
    if (!st) return 'Showing —';
    if (st.overlay) return 'Showing overlay';
    if (st.currentPage == null) return 'Showing —';
    const p = cs.displayPages[st.currentPage];
    return `Showing page ${st.currentPage + 1}${p ? ` · ${Domain.csNounLabel(p.noun)}` : ''}`;
  }

  // --- Settings (CfgDraft) ---

  const liveCfg = $derived(cs.displayCfg ?? Domain.EMPTY_CS_DISPLAY_CFG);
  const cfgSeeded = $derived(cs.displayCfg == null || Domain.csDisplayCfgIsEmpty(cs.displayCfg));
  const cfgSource = $derived(cfgSeeded ? Domain.SEEDED_CS_DISPLAY_CFG : liveCfg);

  function cfgOf(): CfgDraft { return cfgDraft ?? CsDisplayDraft.cfgDraftFromLive(cfgSource); }
  function editCfg(fn: (d: CfgDraft) => void): void {
    const d = cfgDraft ?? CsDisplayDraft.cfgDraftFromLive(cfgSource);
    fn(d);
    cfgDraft = d;
  }
  const cfgDirty = $derived(!CsDisplayDraft.cfgsEqual(CsDisplayDraft.buildCfg(cfgOf()), liveCfg));
  function canApplyCfg(): boolean {
    return cfgDirty && Domain.validateCsDisplayCfg(CsDisplayDraft.buildCfg(cfgOf())) === 0;
  }
  function revertCfg(): void { cfgDraft = null; }

  async function applyCfg(): Promise<void> {
    applying = true;
    try {
      if (await applyCsDisplayCfg(s, CsDisplayDraft.buildCfg(cfgOf()))) cfgDraft = null;
    } finally {
      applying = false;
    }
  }

  function homePageOptions(): { v: number; label: string }[] {
    return Array.from({ length: maxPages }, (_, i) => {
      const p = cs.displayPages[i];
      return { v: i, label: p ? `Page ${i + 1} · ${Domain.csNounLabel(p.noun)}` : `Page ${i + 1} (empty)` };
    });
  }

  function num(e: Event): number | null {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    return Number.isNaN(v) ? null : v;
  }

  // --- Pages (PageDraft[]) ---

  function pageDraftOf(i: number): PageDraft | null {
    const d = pageDrafts[i];
    if (d) return d;
    const live = cs.displayPages[i];
    return live ? CsDisplayDraft.pageDraftFromLive(live) : null;
  }

  function editPageDraft(i: number, fn: (d: PageDraft) => void): void {
    const d = pageDrafts[i] ?? pageDraftOf(i) ?? CsDisplayDraft.defaultPageDraft(cs.nouns);
    fn(d);
    pageDrafts[i] = d;
  }

  function isPageDirty(i: number): boolean {
    const d = pageDrafts[i];
    if (!d) return false;
    const live = cs.displayPages[i];
    if (!live) return true;
    return !CsDisplayDraft.pagesEqual(CsDisplayDraft.buildPage(d, cs.nouns), live);
  }

  function canApplyPage(i: number): boolean {
    const d = pageDrafts[i];
    if (!d || !isPageDirty(i)) return false;
    return Domain.validateCsDisplayPage(CsDisplayDraft.buildPage(d, cs.nouns), cs.nouns, cs.groups) === 0;
  }

  function addPage(i: number): void {
    pageDrafts[i] = CsDisplayDraft.defaultPageDraft(cs.nouns);
  }

  function revertPage(i: number): void { delete pageDrafts[i]; }

  async function applyPage(i: number): Promise<void> {
    const d = pageDrafts[i];
    if (!d) return;
    applying = true;
    try {
      if (await applyCsDisplayPage(s, i, CsDisplayDraft.buildPage(d, cs.nouns))) delete pageDrafts[i];
    } finally {
      applying = false;
    }
  }

  async function removePage(i: number): Promise<void> {
    if (!cs.displayPages[i]) { delete pageDrafts[i]; return; }
    applying = true;
    try {
      if (await clearCsDisplayPage(s, i)) delete pageDrafts[i];
    } finally {
      applying = false;
    }
  }

  function groupOptionsFor(d: PageDraft): { v: number; label: string }[] {
    return CsField.groupsAvailable(caps) ? CsField.groupOptionsFor(cs.nouns, d.noun, cs.groups) : [];
  }
  function groupBandOptionsFor(d: PageDraft): { v: number; label: string }[] {
    const g = cs.groups[d.target];
    return snap && g ? CsField.groupBandOptionsFor(cs.nouns, d.noun, g, snap.channels) : [];
  }

  function pageChipTitle(i: number): string {
    const d = pageDraftOf(i);
    let t = d ? `Page ${i + 1} · ${Domain.csNounLabel(d.noun)}` : `Page ${i + 1} (empty)`;
    if (cs.displayStatus?.currentPage === i) t += ' · showing';
    if (isPageDirty(i)) t += ' · unapplied changes';
    return t;
  }

  function pageStripKey(e: KeyboardEvent): void {
    if (maxPages === 0 || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    selPage = (selPage + delta + maxPages) % maxPages;
    const strip = e.currentTarget as HTMLElement;
    void tick().then(() => strip.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  }

  // Seeded fw defaults are not a user edit: only an actual cfg draft counts.
  const stagedCount = $derived(
    (cfgDraft != null && cfgDirty ? 1 : 0) + Array.from({ length: maxPages }, (_, i) => i).filter((i) => isPageDirty(i)).length,
  );
  $effect(() => { s.controlSurfaces.staged.display = stagedCount; });
</script>

<Panel code="CT.05" title="DISPLAY">
  {#snippet right()}
    <span class="cs-pill {pill().cls}">{pill().text}</span>
  {/snippet}

  {#if cs.displayLimits}
    {#if !displaySlotActive}
      <div class="hint pad">
        No display attached. Add an I2C display in CONTROL SURFACES; the
        settings and pages below apply as soon as it starts.
      </div>
    {:else}
      <div class="statusrow">
        <span class="hint">{modelAddrText()}</span>
        <span class="hint">{showingText()}</span>
        {#if cs.displayStatus?.editArmed}<span class="tag">EDIT ARMED</span>{/if}
      </div>
    {/if}

    <div class="subhdr">SETTINGS</div>
    {@const d = cfgOf()}
    <div class="rows">
      {#if cfgSeeded}
        <div class="hint">Firmware defaults shown — apply them, or attach a display and the firmware seeds the same values.</div>
      {/if}
      <div class="row">
        <span class="pair">
          <span class="microlbl">MODE</span>
          <select class="sel" value={String(d.mode)} aria-label="Display mode" disabled={applying}
            onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); editCfg((dr) => { dr.mode = v as Domain.CsDisplayMode; }); }}>
            {#each [Domain.CsDisplayMode.Fixed, Domain.CsDisplayMode.CycleSelected, Domain.CsDisplayMode.CycleAll] as m (m)}
              <option value={String(m)}>{Domain.CS_DISPLAY_MODE_LABEL[m as Domain.CsDisplayMode]}</option>
            {/each}
          </select>
        </span>
        {#if d.mode === Domain.CsDisplayMode.Fixed}
          <span class="pair">
            <span class="microlbl">HOME PAGE</span>
            <select class="sel" value={String(d.homePage)} aria-label="Home page" disabled={applying}
              onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); editCfg((dr) => { dr.homePage = v; }); }}>
              {#each homePageOptions() as o (o.v)}
                <option value={String(o.v)}>{o.label}</option>
              {/each}
            </select>
          </span>
        {:else}
          <span class="pair">
            <span class="microlbl">DWELL</span>
            <input class="numfield" type="number" step="0.1" min="1"
              value={d.dwell} aria-label="Dwell time (s)" disabled={applying}
              onchange={(e) => { const v = num(e); if (v != null) editCfg((dr) => { dr.dwell = v; }); }} />
            <span class="hint">s</span>
          </span>
        {/if}
      </div>

      <div class="row">
        <span class="pair">
          <span class="microlbl">POP-UP HOLD</span>
          <input class="numfield" type="number" step="0.1" min="0"
            value={d.overlayHold} aria-label="Pop-up hold time (s, 0 = off)" disabled={applying}
            onchange={(e) => { const v = num(e); if (v != null) editCfg((dr) => { dr.overlayHold = v; }); }} />
          <span class="hint">s (0 = off)</span>
        </span>
        <span class="pair">
          <span class="microlbl">EDIT TIMEOUT</span>
          <input class="numfield" type="number" step="0.1" min="0"
            value={d.editTimeout} aria-label="Edit auto-disarm timeout (s, 0 = manual)" disabled={applying}
            onchange={(e) => { const v = num(e); if (v != null) editCfg((dr) => { dr.editTimeout = v; }); }} />
          <span class="hint">s (0 = manual)</span>
        </span>
      </div>

      <div class="row">
        <span class="pair">
          <span class="microlbl">BRIGHTNESS</span>
          <input class="numfield" type="number" step="1" min="0" max="255"
            value={d.brightness} aria-label="Brightness (0 = default)" disabled={applying}
            title="OLED contrast — takes effect when the display restarts"
            onchange={(e) => { const v = num(e); if (v != null) editCfg((dr) => { dr.brightness = v; }); }} />
          <span class="hint">0 = default</span>
        </span>
      </div>

      <div class="row">
        <span class="pair">
          <span class="microlbl" title="Show items that have no page too">POP UP ANY CHANGE</span>
          <ToggleSwitch size="sm" checked={d.overlayAny} disabled={applying}
            ariaLabel="Pop up on any change"
            onChange={(v) => editCfg((dr) => { dr.overlayAny = v; })} />
        </span>
        <span class="pair">
          <span class="microlbl" title="Off: the value control adjusts the shown item directly">ARM BEFORE EDIT</span>
          <ToggleSwitch size="sm" checked={d.editGated} disabled={applying}
            ariaLabel="Require arming before edit"
            onChange={(v) => editCfg((dr) => { dr.editGated = v; })} />
        </span>
      </div>

      {#if (caps?.capsVersion ?? 0) >= 11}
        <div class="row">
          <span class="pair">
            <span class="microlbl">LABEL ALIGN</span>
            <select class="sel" value={String(d.labelAlign)} aria-label="Label alignment" disabled={applying}
              onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); editCfg((dr) => { dr.labelAlign = v as Domain.CsDisplayAlign; }); }}>
              {#each [Domain.CsDisplayAlign.Left, Domain.CsDisplayAlign.Centre, Domain.CsDisplayAlign.Right] as a (a)}
                <option value={String(a)}>{Domain.CS_DISPLAY_ALIGN_LABEL[a as Domain.CsDisplayAlign]}</option>
              {/each}
            </select>
          </span>
          <span class="pair">
            <span class="microlbl">VALUE ALIGN</span>
            <select class="sel" value={String(d.valueAlign)} aria-label="Value alignment" disabled={applying}
              onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); editCfg((dr) => { dr.valueAlign = v as Domain.CsDisplayAlign; }); }}>
              {#each [Domain.CsDisplayAlign.Left, Domain.CsDisplayAlign.Centre, Domain.CsDisplayAlign.Right] as a (a)}
                <option value={String(a)}>{Domain.CS_DISPLAY_ALIGN_LABEL[a as Domain.CsDisplayAlign]}</option>
              {/each}
            </select>
          </span>
        </div>
      {/if}

      <div class="row">
        <button type="button" class="chip accent" onclick={applyCfg}
          disabled={applying || !canApplyCfg()}>APPLY</button>
        <button type="button" class="chip hi" onclick={revertCfg}
          disabled={applying || cfgDraft == null}>REVERT</button>
      </div>
    </div>

    <div class="subhdr">PAGES</div>
    {#if maxPages > 0}
      {@const i = selPage}
      {@const live = cs.displayPages[i]}
      {@const d = pageDraftOf(i)}
      {@const showing = cs.displayStatus?.currentPage === i}
      {@const staged = isPageDirty(i)}
      <div class="rows">
        <!-- Strip selects which page the editor below shows; view-only, no fw effect -->
        <div class="pagestrip" role="tablist" aria-label="Display pages" tabindex="-1" onkeydown={pageStripKey}>
          {#each Array.from({ length: maxPages }, (_, i2) => i2) as i2 (i2)}
            <button type="button" role="tab" class="pchip"
              class:sel={i2 === selPage} class:set={pageDraftOf(i2) != null}
              class:showing={cs.displayStatus?.currentPage === i2} class:staged={isPageDirty(i2)}
              aria-selected={i2 === selPage} tabindex={i2 === selPage ? 0 : -1}
              aria-label={`Page ${i2 + 1}`} title={pageChipTitle(i2)}
              onclick={() => { selPage = i2; }}>{i2 + 1}</button>
          {/each}
        </div>

        <div class="slot">
          <div class="slothead">
            <span class="stitle" class:showing class:staged
              title={staged ? 'Unapplied changes — APPLY to preview them live' : undefined}
              >PAGE {i + 1}</span>
            {#if showing}<span class="tag">SHOWING</span>{/if}
            <span class="spacer"></span>
            {#if !d}
              <button type="button" class="chip" disabled={applying} onclick={() => addPage(i)}>Set page {i + 1}</button>
            {:else}
              <button type="button" class="x" aria-label={`Remove page ${i + 1}`}
                disabled={applying} onclick={() => removePage(i)}>✕</button>
            {/if}
          </div>

          {#if !d}
            <div class="hint">Page {i + 1} is empty.</div>
          {:else}
            {@const showGroup = CsField.groupsAvailable(caps) && CsField.showTargetOf(cs.nouns, d.noun)}
            {@const groupOpts = groupOptionsFor(d)}
            {@const missingGroup = showGroup && d.grouped && !groupOpts.some((o) => o.v === d.target)}
            <div class="row">
              <span class="pair">
                <span class="microlbl">ITEM</span>
                <select class="sel" value={String(d.noun)} aria-label={`Item for page ${i + 1}`} disabled={applying}
                  onchange={(e) => {
                    const n = Number((e.currentTarget as HTMLSelectElement).value);
                    editPageDraft(i, (dr) => { dr.noun = n; dr.target = 0; dr.index = 0; dr.grouped = false; dr.bar = false; });
                  }}>
                  {#each CsField.pageNounOptions(cs.nouns) as o (o.v)}
                    <option value={String(o.v)}>{o.label}</option>
                  {/each}
                </select>
              </span>
              <span class="pair">
                <span class="microlbl" title="Big value on graphic OLEDs">LARGE</span>
                <ToggleSwitch size="sm" checked={d.large} disabled={applying}
                  ariaLabel="Big value on graphic OLEDs"
                  onChange={(v) => editPageDraft(i, (dr) => { dr.large = v; })} />
              </span>
              {#if (caps?.capsVersion ?? 0) >= 13 && cs.nouns[d.noun] && Domain.csNounHasSpan(cs.nouns[d.noun])}
                <span class="pair">
                  <span class="microlbl" title={barTitle}>BAR</span>
                  <ToggleSwitch size="sm" checked={d.bar} disabled={applying}
                    ariaLabel="Level bar"
                    onChange={(v) => editPageDraft(i, (dr) => { dr.bar = v; })} />
                </span>
              {/if}
            </div>

            {#if CsField.showTargetOf(cs.nouns, d.noun)}
              <div class="row">
                <span class="pair">
                  <span class="microlbl">
                    {CsField.targetKindOf(cs.nouns, d.noun) === Domain.CS_TARGET_INPUT_CH ? 'INPUT'
                      : CsField.targetKindOf(cs.nouns, d.noun) === Domain.CS_TARGET_OUTPUT_CH ? 'OUTPUT' : 'CHANNEL'}
                  </span>
                  <select class="sel" value={d.grouped ? `g${d.target}` : String(d.target)} aria-label={`Target for page ${i + 1}`} disabled={applying}
                    onchange={(e) => {
                      const v = (e.currentTarget as HTMLSelectElement).value;
                      editPageDraft(i, (dr) => {
                        if (v.startsWith('g')) { dr.grouped = true; dr.target = Number(v.slice(1)); }
                        else { dr.grouped = false; dr.target = Number(v); }
                        dr.index = 0;
                      });
                    }}>
                    {#if showGroup && (groupOpts.length > 0 || missingGroup)}
                      <optgroup label="CHANNELS">
                        {#each (snap ? CsField.targetOptionsFor(cs.nouns, d.noun, snap.channels) : []) as o (o.v)}
                          <option value={String(o.v)}>{o.label}</option>
                        {/each}
                      </optgroup>
                      <optgroup label="GROUPS">
                        {#each groupOpts as o (o.v)}
                          <option value={`g${o.v}`}>{o.label}</option>
                        {/each}
                        {#if missingGroup}
                          <option value={`g${d.target}`} disabled>Group {d.target + 1} (missing)</option>
                        {/if}
                      </optgroup>
                    {:else}
                      {#each (snap ? CsField.targetOptionsFor(cs.nouns, d.noun, snap.channels) : []) as o (o.v)}
                        <option value={String(o.v)}>{o.label}</option>
                      {/each}
                    {/if}
                  </select>
                </span>
                {#if CsField.showBandOf(cs.nouns, d.noun)}
                  <span class="pair">
                    <span class="microlbl">BAND</span>
                    <select class="sel" value={String(d.index)} aria-label={`Band for page ${i + 1}`} disabled={applying}
                      onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); editPageDraft(i, (dr) => { dr.index = v; }); }}>
                      {#each (d.grouped ? groupBandOptionsFor(d) : (snap ? CsField.bandOptionsFor(d.noun, d.target, snap.channels) : [])) as o (o.v)}
                        <option value={String(o.v)}>{o.label}</option>
                      {/each}
                    </select>
                  </span>
                {/if}
              </div>
            {/if}

            <div class="row">
              <button type="button" class="chip accent" onclick={() => applyPage(i)}
                disabled={applying || !canApplyPage(i)}>APPLY</button>
              <button type="button" class="chip hi" onclick={() => revertPage(i)}
                disabled={applying || !live || !staged}>REVERT</button>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  {:else if cs.lastFetchError}
    <div class="hint err pad">{cs.lastFetchError}</div>
  {:else}
    <div class="hint pad">Reading display capabilities…</div>
  {/if}
</Panel>

<style>
  .statusrow {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px 0;
    flex-wrap: wrap;
  }
  .tag {
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 1px 6px;
    border-radius: 999px;
    color: var(--accent);
    border: 1px solid color-mix(in oklab, var(--accent) 50%, transparent);
  }
  .subhdr {
    padding: 10px 14px 4px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.2px;
    color: var(--text-faint);
    text-transform: uppercase;
  }
  .rows { padding: 4px 14px 10px; display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .pair { display: inline-flex; align-items: center; gap: 8px; }
  .slot { padding: 8px 0; }
  .pagestrip { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 0 8px; }
  .pchip {
    min-width: 24px;
    height: 24px;
    padding: 0 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    color: var(--text-faint);
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: 4px;
    cursor: pointer;
    position: relative;
  }
  .pchip.set { color: var(--text-dim); background: var(--wash-faint); border-style: solid; }
  .pchip:hover:not(.sel) { color: var(--text); background: var(--wash); }
  .pchip.sel { color: var(--text); border-color: var(--accent); background: color-mix(in oklab, var(--accent) 12%, transparent); }
  .pchip.showing { color: var(--ok); }
  .pchip.showing.sel { border-color: var(--ok); background: color-mix(in oklab, var(--ok) 12%, transparent); }
  .pchip.staged::after {
    content: '';
    position: absolute;
    top: -2px;
    right: -2px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 4px var(--accent);
  }
  .pchip:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }
  .slothead {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 6px;
    font-family: var(--font-mono);
  }
  .stitle {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.2px;
    color: var(--text-dim);
  }
  .stitle.showing { color: var(--ok); }
  .spacer { flex: 1; }
  .x {
    background: none;
    border: none;
    color: var(--text-faint);
    cursor: pointer;
    padding: 0;
    font-size: 9px;
    line-height: 1;
  }
  .x:hover:not(:disabled) { color: var(--err); }
  .x:disabled { opacity: var(--dim-disabled); cursor: default; }
  .sel {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 6px;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }
  .sel:disabled { opacity: var(--dim-disabled); cursor: default; }
  .numfield {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 3px 6px;
    width: 64px;
  }
  .hint.err { color: var(--err); }
  .pad { padding: 10px 14px; }
</style>
