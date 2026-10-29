<script lang="ts">
  // I2C display settings + pages editor (caps v10+): one CfgDraft for the
  // display's own settings blob (mode/dwell/overlay/alignment) and up to 16
  // PageDraft rows, one per display page slot. Sibling of CsGroupsPanel/
  // CsMacrosPanel -- same fw dirty flag; save/discard live in the CHANGES
  // panel. Config/pages are live whether or not a display is attached
  // (fw accepts them in advance); the status row/poll only make sense once a
  // binding is actually running.
  import { tick, untrack } from 'svelte';
  import Panel from '@/components/chrome/Panel.svelte';
  import ToggleSwitch from '@/components/chrome/ToggleSwitch.svelte';
  import * as Runtime from '@/runtime';
  import * as Domain from '@/domain';
  import { getSession } from '@/components/sessionContext';
  import { formatI2cAddr } from '@/components/chrome/format';
  import { portal } from '@/components/chrome/portal';
  import NumField from '@/components/chrome/NumField.svelte';
  import CsTargetRow from './CsTargetRow.svelte';
  import * as SlotOps from './csSlotOps';
  import * as CsField from '@/domain/cs/fieldHelpers';
  import * as CsDisplayDraft from '@/domain/cs/displayDraft';
  import type { CfgDraft, PageDraft } from '@/domain/cs/displayDraft';

  // Split layout: the selected page's editor renders in this element instead of below the strip.
  // `visible`: only the page on screen holds the poll interest.
  const { detailTarget = null, visible }: { detailTarget?: HTMLElement | null; visible: boolean } = $props();

  const s = getSession();
  const snap = $derived(s.mirror.current);
  const cs = $derived(s.controlSurfaces);
  const caps = $derived(s.controlSurfaces.caps);

  // Firmware dropped every saved level-bar page at boot until the caps v17
  // sanitizer fix, so the warning only applies to caps 13-16 devices.
  const barTitle = $derived((caps?.capsVersion ?? 0) >= 17
    ? 'Level bar'
    : 'Level bar. Note: this fw build drops bars on reboot');

  // One 'display' draft family: the settings blob under CFG, pages under their index.
  const CFG = -1;
  const cfgDrafts = s.drafts.of<CfgDraft>('display');
  const pageDrafts = s.drafts.of<PageDraft>('display');
  const cfgDraft = $derived(cfgDrafts.draftOf(CFG) ?? null);
  let applying = $state(false);
  function setApplying(busy: boolean): void { applying = busy; }

  const maxPages = $derived(Math.min(cs.displayLimits?.maxPages ?? 0, Domain.CS_MAX_DISPLAY_PAGES));

  // Which page the single editor below shows -- a view choice, not fw state.
  let pickedPage = $state(0);
  const selPage = $derived(maxPages > 0 ? Math.min(pickedPage, maxPages - 1) : pickedPage);

  const displaySlotActive = $derived(Domain.csDisplaySlotActive(cs.bindings, cs.status));
  const displayBinding = $derived(cs.bindings.find((b) => b?.type === Domain.CsType.Display) ?? null);

  // The display-status cadence (poll.ts) keeps the pill and showing line
  // tracking the front panel; this panel holds its interest.
  $effect(() => (visible ? untrack(() => Runtime.wantCsDisplayPoll(s)) : undefined));

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
    return `${model} · addr ${formatI2cAddr(addr)}`;
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
    cfgDrafts.editDraft(CFG, d);
  }
  const cfgDirty = $derived(!CsDisplayDraft.cfgsEqual(CsDisplayDraft.buildCfg(cfgOf()), liveCfg));
  function canApplyCfg(): boolean {
    return cfgDirty && Domain.validateCsDisplayCfg(CsDisplayDraft.buildCfg(cfgOf())) === 0;
  }
  function revertCfg(): void { cfgDrafts.revert(CFG); }

  async function applyCfg(): Promise<void> {
    await SlotOps.applySlot(CFG, cfgDrafts, setApplying, () => Runtime.applyCsDisplayCfg(s, CsDisplayDraft.buildCfg(cfgOf())));
  }

  function homePageOptions(): { v: number; label: string }[] {
    return Array.from({ length: maxPages }, (_, i) => {
      const p = cs.displayPages[i];
      return { v: i, label: p ? `Page ${i + 1} · ${Domain.csNounLabel(p.noun)}` : `Page ${i + 1} (empty)` };
    });
  }

  // --- Pages (PageDraft[]) ---

  function pageDraftOf(i: number): PageDraft | null {
    const d = pageDrafts.draftOf(i);
    if (d) return d;
    const live = cs.displayPages[i];
    return live ? CsDisplayDraft.pageDraftFromLive(live) : null;
  }

  function editPageDraft(i: number, fn: (d: PageDraft) => void): void {
    const d = pageDrafts.draftOf(i) ?? pageDraftOf(i) ?? CsDisplayDraft.defaultPageDraft(cs.nouns);
    fn(d);
    pageDrafts.editDraft(i, d);
  }

  function isPageDirty(i: number): boolean {
    const d = pageDrafts.draftOf(i);
    if (!d) return false;
    const live = cs.displayPages[i];
    if (!live) return true;
    return !CsDisplayDraft.pagesEqual(CsDisplayDraft.buildPage(d, cs.nouns), live);
  }

  function canApplyPage(i: number): boolean {
    const d = pageDrafts.draftOf(i);
    if (!d || !isPageDirty(i)) return false;
    return Domain.validateCsDisplayPage(CsDisplayDraft.buildPage(d, cs.nouns), cs.nouns, cs.groups) === 0;
  }

  function addPage(i: number): void {
    pageDrafts.editDraft(i, CsDisplayDraft.defaultPageDraft(cs.nouns));
  }

  function revertPage(i: number): void { pageDrafts.revert(i); }

  async function applyPage(i: number): Promise<void> {
    const d = pageDrafts.draftOf(i);
    if (!d) return;
    await SlotOps.applySlot(i, pageDrafts, setApplying, () => Runtime.applyCsDisplayPage(s, i, CsDisplayDraft.buildPage(d, cs.nouns)));
  }

  async function removePage(i: number): Promise<void> {
    await SlotOps.removeSlot(i, cs.displayPages[i] != null, pageDrafts, setApplying, () => Runtime.clearCsDisplayPage(s, i));
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
    pickedPage = (selPage + delta + maxPages) % maxPages;
    const strip = e.currentTarget as HTMLElement;
    void tick().then(() => strip.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  }

  // Seeded fw defaults are not a user edit: only an actual cfg draft counts.
  $effect(() => {
    const cfg = cfgDraft != null ? cfgDirty : null;
    const pages = pageDrafts.keys().filter((i) => i >= 0).map((i) => [i, isPageDirty(i)] as const);
    untrack(() => {
      if (cfg != null) cfgDrafts.setDirty(CFG, cfg);
      for (const [i, dirty] of pages) pageDrafts.setDirty(i, dirty);
    });
  });
</script>

<Panel title="DISPLAY">
  {#snippet right()}
    <span class="cs-pill {pill().cls}">{pill().text}</span>
  {/snippet}

  {#if cs.displayLimits}
    {#if !displaySlotActive}
      <div class="hint cs-pad">
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
    <div class="cs-rows">
      {#if cfgSeeded}
        <div class="hint">Firmware defaults shown — apply them, or attach a display and the firmware seeds the same values.</div>
      {/if}
      <div class="cs-row">
        <span class="cs-pair">
          <span class="microlbl">MODE</span>
          <select class="sel" value={String(d.mode)} aria-label="Display mode" disabled={applying}
            onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); editCfg((dr) => { dr.mode = v as Domain.CsDisplayMode; }); }}>
            {#each [Domain.CsDisplayMode.Fixed, Domain.CsDisplayMode.CycleSelected, Domain.CsDisplayMode.CycleAll] as m (m)}
              <option value={String(m)}>{Domain.CS_DISPLAY_MODE_LABEL[m as Domain.CsDisplayMode]}</option>
            {/each}
          </select>
        </span>
        {#if d.mode === Domain.CsDisplayMode.Fixed}
          <span class="cs-pair">
            <span class="microlbl">HOME PAGE</span>
            <select class="sel" value={String(d.homePage)} aria-label="Home page" disabled={applying}
              onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); editCfg((dr) => { dr.homePage = v; }); }}>
              {#each homePageOptions() as o (o.v)}
                <option value={String(o.v)}>{o.label}</option>
              {/each}
            </select>
          </span>
        {:else}
          <span class="cs-pair">
            <span class="microlbl">DWELL</span>
            <NumField value={d.dwell} min={1} max={6553.5} step={0.1} kind="s" precision={1}
              ariaLabel="Dwell time (s)" disabled={applying}
              onChange={(v) => editCfg((dr) => { dr.dwell = v; })} />
          </span>
        {/if}
      </div>

      <div class="cs-row">
        <span class="cs-pair">
          <span class="microlbl">POP-UP HOLD</span>
          <NumField value={d.overlayHold} min={0} max={6553.5} step={0.1} kind="s" precision={1} hint="(0 = off)"
            ariaLabel="Pop-up hold time (s, 0 = off)" disabled={applying}
            onChange={(v) => editCfg((dr) => { dr.overlayHold = v; })} />
        </span>
        <span class="cs-pair">
          <span class="microlbl">EDIT TIMEOUT</span>
          <NumField value={d.editTimeout} min={0} max={6553.5} step={0.1} kind="s" precision={1} hint="(0 = manual)"
            ariaLabel="Edit auto-disarm timeout (s, 0 = manual)" disabled={applying}
            onChange={(v) => editCfg((dr) => { dr.editTimeout = v; })} />
        </span>
      </div>

      <div class="cs-row">
        <span class="cs-pair">
          <span class="microlbl">BRIGHTNESS</span>
          <NumField value={d.brightness} min={0} max={255} step={1} kind="int" precision={0} hint="0 = default"
            ariaLabel="Brightness (0 = default)" title="OLED contrast — takes effect when the display restarts" disabled={applying}
            onChange={(v) => editCfg((dr) => { dr.brightness = v; })} />
        </span>
      </div>

      <div class="cs-row">
        <span class="cs-pair">
          <span class="microlbl" title="Show items that have no page too">POP UP ANY CHANGE</span>
          <ToggleSwitch checked={d.overlayAny} disabled={applying}
            ariaLabel="Pop up on any change"
            onChange={(v) => editCfg((dr) => { dr.overlayAny = v; })} />
        </span>
        <span class="cs-pair">
          <span class="microlbl" title="Off: the value control adjusts the shown item directly">ARM BEFORE EDIT</span>
          <ToggleSwitch checked={d.editGated} disabled={applying}
            ariaLabel="Require arming before edit"
            onChange={(v) => editCfg((dr) => { dr.editGated = v; })} />
        </span>
      </div>

      {#if (caps?.capsVersion ?? 0) >= 11}
        <div class="cs-row">
          <span class="cs-pair">
            <span class="microlbl">LABEL ALIGN</span>
            <select class="sel" value={String(d.labelAlign)} aria-label="Label alignment" disabled={applying}
              onchange={(e) => { const v = Number((e.currentTarget as HTMLSelectElement).value); editCfg((dr) => { dr.labelAlign = v as Domain.CsDisplayAlign; }); }}>
              {#each [Domain.CsDisplayAlign.Left, Domain.CsDisplayAlign.Centre, Domain.CsDisplayAlign.Right] as a (a)}
                <option value={String(a)}>{Domain.CS_DISPLAY_ALIGN_LABEL[a as Domain.CsDisplayAlign]}</option>
              {/each}
            </select>
          </span>
          <span class="cs-pair">
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

      <div class="cs-row">
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
      <div class="cs-rows">
        <!-- Strip selects which page the editor below shows; view-only, no fw effect -->
        <div class="pagestrip" role="tablist" aria-label="Display pages" tabindex="-1" onkeydown={pageStripKey}>
          {#each Array.from({ length: maxPages }, (_, i2) => i2) as i2 (i2)}
            <button type="button" role="tab" class="pchip" id={`cs-display-page-tab-${i2}`}
              class:sel={i2 === selPage} class:set={pageDraftOf(i2) != null}
              class:showing={cs.displayStatus?.currentPage === i2} class:draft={isPageDirty(i2)}
              aria-selected={i2 === selPage} aria-controls="cs-display-page-panel" tabindex={i2 === selPage ? 0 : -1}
              aria-label={`Page ${i2 + 1}`} title={pageChipTitle(i2)}
              onclick={() => { pickedPage = i2; }}>{i2 + 1}</button>
          {/each}
        </div>

        <div class="slot" class:detached={detailTarget != null} id="cs-display-page-panel" role="tabpanel"
          aria-labelledby={`cs-display-page-tab-${i}`} use:portal={detailTarget}>
          <div class="slothead">
            <span class="cs-stitle" class:showing class:draft={staged}
              title={staged ? 'Unapplied changes — APPLY to preview them live' : undefined}
              >PAGE {i + 1}</span>
            {#if showing}<span class="tag">SHOWING</span>{/if}
            <span class="cs-spacer"></span>
            {#if !d}
              <button type="button" class="chip" disabled={applying} onclick={() => addPage(i)}>Set page {i + 1}</button>
            {:else}
              <button type="button" class="x-btn" aria-label={`Remove page ${i + 1}`}
                disabled={applying} onclick={() => removePage(i)}>✕</button>
            {/if}
          </div>

          {#if !d}
            <div class="hint">Page {i + 1} is empty.</div>
          {:else}
            <div class="cs-row">
              <span class="cs-pair">
                <span class="microlbl">ITEM</span>
                <select class="sel" value={String(d.noun)} aria-label={`Item for page ${i + 1}`} disabled={applying}
                  onchange={(e) => {
                    const n = Number((e.currentTarget as HTMLSelectElement).value);
                    editPageDraft(i, (dr) => { dr.noun = n; dr.target = 0; dr.index = 0; dr.grouped = false; dr.bar = false; });
                  }}>
                  {#each CsField.pageNounOptions(cs.nouns, d.noun) as o (o.v)}
                    <option value={String(o.v)}>{o.label}</option>
                  {/each}
                </select>
              </span>
              <span class="cs-pair">
                <span class="microlbl" title="Big value on graphic OLEDs">LARGE</span>
                <ToggleSwitch checked={d.large} disabled={applying}
                  ariaLabel="Big value on graphic OLEDs"
                  onChange={(v) => editPageDraft(i, (dr) => { dr.large = v; })} />
              </span>
              {#if (caps?.capsVersion ?? 0) >= 13 && cs.nouns[d.noun] && Domain.csNounHasSpan(cs.nouns[d.noun])}
                <span class="cs-pair">
                  <span class="microlbl" title={barTitle}>BAR</span>
                  <ToggleSwitch checked={d.bar} disabled={applying}
                    ariaLabel="Level bar"
                    onChange={(v) => editPageDraft(i, (dr) => { dr.bar = v; })} />
                </span>
              {/if}
            </div>

            {#if CsField.showTargetOf(cs.nouns, d.noun)}
              <div class="cs-row">
                <CsTargetRow nouns={cs.nouns} noun={d.noun} target={d.target} index={d.index} grouped={d.grouped}
                  channels={snap?.channels ?? []} groups={cs.groups} groupsEnabled={CsField.groupsAvailable(caps)}
                  disabled={applying} ariaSuffix={` for page ${i + 1}`}
                  onTarget={(pick) => editPageDraft(i, (dr) => { dr.grouped = pick.grouped; dr.target = pick.target; dr.index = 0; })}
                  onBand={(v) => editPageDraft(i, (dr) => { dr.index = v; })} />
              </div>
            {/if}

            <div class="cs-row">
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
    <div class="hint err cs-pad">{cs.lastFetchError}</div>
  {:else}
    <div class="hint cs-pad">Reading display capabilities…</div>
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
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 1px;
    padding: 1px 6px;
    border-radius: 999px;
    color: var(--accent);
    border: 1px solid color-mix(in oklab, var(--accent) var(--tint-edge), transparent);
  }
  .subhdr {
    padding: 10px 14px 4px;
  }
  .slot { padding: 8px 0; }
  .slot.detached { padding: 8px 14px 10px; }
  .pagestrip { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 0 8px; }
  .pchip {
    min-width: 24px;
    height: var(--h-row);
    padding: 0 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    color: var(--text-faint);
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: var(--radius-s);
    cursor: pointer;
    position: relative;
  }
  .pchip.set { color: var(--text-dim); background: var(--wash-faint); border-style: solid; }
  .pchip:hover:not(.sel) { color: var(--text); background: var(--wash); }
  .pchip.sel { color: var(--text); border-color: var(--accent); background: color-mix(in oklab, var(--accent) var(--tint), transparent); }
  .pchip.showing { color: var(--ok); }
  .pchip.showing.sel { border-color: var(--ok); background: color-mix(in oklab, var(--ok) var(--tint), transparent); }
  .pchip.draft::after { top: -2px; right: -2px; }
  .slothead {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 6px;
    font-family: var(--font-mono);
  }
  .cs-stitle.showing { color: var(--ok); }
</style>
