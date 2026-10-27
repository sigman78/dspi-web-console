<script lang="ts">
  import { connection, settings, setVolumeAxis } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import * as Runtime from '@/runtime';
  import SaveMasterVolumeButton from '@/components/presets/SaveMasterVolumeButton.svelte';
  import PresetIcon from './presets/PresetIcon.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import { MASTER_VOLUME_MAX_POS, masterDbToPos, posToMasterDb, formatMasterDb } from '@/components/chrome/masterVolumeTaper';

  const s = getSession();
  const connected = $derived(connection.connected);
  const muted = $derived(s.mirror.current?.userVolume.mute ?? false);
  const bypassed = $derived(s.mirror.current?.bypass ?? false);
  const isMaster = $derived(settings.volumeAxis === 'master');
  const masterDb = $derived(s.mirror.current?.masterVolumeDb ?? 0);
  const userDb = $derived(s.mirror.current?.userVolume.volumeDb ?? 0);
  const readout = $derived(isMaster ? formatMasterDb(masterDb) : userDb.toFixed(0));

  function onInput(e: Event) {
    const raw = parseFloat((e.target as HTMLInputElement).value);
    if (Number.isNaN(raw)) return;
    if (isMaster) Runtime.setMasterVolume(s, posToMasterDb(raw));
    else Runtime.setUserVolume(s, raw);
  }
</script>

<div class="vtop">
  <SegmentedSelect
    value={settings.volumeAxis}
    options={[{ value: 'user', label: 'User' }, { value: 'master', label: 'Master' }]}
    ariaLabel="Volume axis"
    onChange={setVolumeAxis}
  />
  <button
    type="button"
    class="icon-toggle mute"
    class:on={muted}
    onclick={() => Runtime.toggleMute(s)}
    disabled={!connected}
    title={muted ? 'Unmute' : 'Mute'}
    aria-label={muted ? 'Unmute' : 'Mute'}
  >
    {#if muted}
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h2l3-3v10l-3-3H3z" fill="currentColor" />
        <line x1="11" y1="6" x2="14" y2="9" />
        <line x1="14" y1="6" x2="11" y2="9" />
      </svg>
    {:else}
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h2l3-3v10l-3-3H3z" fill="currentColor" />
        <path d="M11 5.5a3 3 0 0 1 0 5" />
      </svg>
    {/if}
  </button>
  <button
    type="button"
    class="icon-toggle bypass"
    class:on={bypassed}
    onclick={() => Runtime.setBypass(s, !bypassed)}
    disabled={!connected}
    title={bypassed ? 'EQ bypass on (signal passes through)' : 'EQ active'}
    aria-label={bypassed ? 'Disable EQ bypass' : 'Enable EQ bypass'}
    aria-pressed={bypassed}
  >
    <PresetIcon icon="bypass" />
  </button>
</div>
<div class="vrow">
  <input
    type="range"
    class:muted
    class:master={isMaster}
    min={isMaster ? 0 : -60}
    max={isMaster ? MASTER_VOLUME_MAX_POS : 0}
    step="1"
    value={isMaster ? masterDbToPos(masterDb) : userDb}
    oninput={onInput}
    disabled={!connected}
    aria-label={isMaster ? 'Master volume' : 'User volume'}
    aria-valuetext={readout}
  />
  <span class="val" class:muted>{connected ? readout : '—'}<u>dB</u></span>
  {#if isMaster}<SaveMasterVolumeButton />{/if}
</div>

<style>
  .vtop { display: flex; align-items: stretch; gap: 4px; height: 24px; }
  .vtop :global(.seg) { flex: 1; }
  .vtop :global(.opt) { padding: 3px 4px; font-size: 11px; font-family: var(--font-sans); letter-spacing: 0; }
  .vtop .icon-toggle { align-self: center; }
  .vrow { display: flex; align-items: center; gap: 6px; height: 22px; }
  input[type="range"] {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: 0;
    accent-color: var(--accent);
  }
  input[type="range"].master { accent-color: var(--err); }
  input[type="range"].muted { accent-color: var(--text-faint); opacity: 0.45; }
  input[type="range"]:disabled { opacity: var(--dim-disabled); }
  .val {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text);
    min-width: 58px;
    text-align: right;
    white-space: nowrap;
  }
  .val.muted { color: var(--text-faint); }
  .val u { text-decoration: none; color: var(--text-faint); margin-left: 2px; font-size: 11px; }
</style>
