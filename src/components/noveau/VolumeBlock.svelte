<script lang="ts">
  import { connection, settings, setVolumeAxis } from '@/state';
  import { getSession } from '@/components/sessionContext';
  import { setMasterVolume, setUserVolume, toggleMute } from '@/runtime';
  import SaveMasterVolumeButton from '@/components/presets/SaveMasterVolumeButton.svelte';
  import SegmentedSelect from '@/components/chrome/SegmentedSelect.svelte';
  import { MASTER_VOLUME_MAX_POS, masterDbToPos, posToMasterDb, formatMasterDb } from '@/components/chrome/masterVolumeTaper';

  const s = getSession();
  const connected = $derived(connection.connected);
  const muted = $derived(s.mirror.current?.userVolume.mute ?? false);
  const isMaster = $derived(settings.volumeAxis === 'master');
  const masterDb = $derived(s.mirror.current?.masterVolumeDb ?? 0);
  const userDb = $derived(s.mirror.current?.userVolume.volumeDb ?? 0);
  const readout = $derived(isMaster ? formatMasterDb(masterDb) : userDb.toFixed(0));

  function onInput(e: Event) {
    const raw = parseFloat((e.target as HTMLInputElement).value);
    if (Number.isNaN(raw)) return;
    if (isMaster) setMasterVolume(s, posToMasterDb(raw));
    else setUserVolume(s, raw);
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
    class="chip hi"
    class:on={muted}
    disabled={!connected}
    aria-pressed={muted}
    onclick={() => toggleMute(s)}
  >MUTE</button>
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
  .vtop .chip { padding: 0 8px; font-size: 11px; letter-spacing: 0; font-family: var(--font-sans); font-weight: 600; }
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
