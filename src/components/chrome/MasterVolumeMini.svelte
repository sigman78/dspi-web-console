<script lang="ts">
  import { connection, activeSession, settings, setVolumeAxis } from '@/state';
  import { setMasterVolume, setUserVolume, toggleMute } from '@/runtime';
  import SaveMasterVolumeButton from '@/components/presets/SaveMasterVolumeButton.svelte';

  const s = $derived(activeSession());
  const connected = $derived(connection.connected);
  const muted = $derived(s?.mirror.current?.userVolume.mute ?? false);

  const isMaster = $derived(settings.volumeAxis === 'master');
  const masterVolumeDb = $derived(s?.mirror.current?.masterVolumeDb ?? 0);
  const userVolumeDb = $derived(s?.mirror.current?.userVolume.volumeDb ?? 0);
  const displayDb = $derived(isMaster ? masterVolumeDb : userVolumeDb);

  function onChange(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (Number.isNaN(v) || !s) return;
    if (isMaster) setMasterVolume(s, v);
    else setUserVolume(s, v);
  }

  // Just swaps which value the slider shows -- never copies a value across
  // axes, never sends a write.
  function toggleAxis() {
    setVolumeAxis(isMaster ? 'user' : 'master');
  }
</script>

<div class="vol">
  <button
    class="microlbl axis-toggle"
    onclick={toggleAxis}
    title={isMaster
      ? 'Master volume — device output ceiling, invisible to the OS. Click to control user volume.'
      : 'User volume — mirrors the OS volume while USB input is active. Click to control the master ceiling.'}
    aria-label={isMaster
      ? 'Volume axis: master volume. Switch to user volume.'
      : 'Volume axis: user volume. Switch to master volume.'}
  >{isMaster ? 'MASTER' : 'USER'}</button>
  <input
    type="range"
    class:muted
    class:master={isMaster}
    min="-60" max="0" step={isMaster ? 0.5 : 1}
    value={displayDb}
    oninput={onChange}
    disabled={!connected}
    aria-label={isMaster ? 'Master volume' : 'User volume'}
  />
  <span class="db" class:muted>
    {connected ? displayDb.toFixed(isMaster ? 1 : 0) : '—'}
  </span>
  <button
    class="icon-toggle mute"
    class:on={muted}
    onclick={() => { if (s) toggleMute(s); }}
    disabled={!connected}
    title={muted ? 'Unmute' : 'Mute'}
    aria-label={muted ? 'Unmute' : 'Mute'}
  >
    {#if muted}
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h2l3-3v10l-3-3H3z" fill="currentColor" />
        <line x1="11" y1="6" x2="14" y2="9" />
        <line x1="14" y1="6" x2="11" y2="9" />
      </svg>
    {:else}
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h2l3-3v10l-3-3H3z" fill="currentColor" />
        <path d="M11 5.5a3 3 0 0 1 0 5" />
      </svg>
    {/if}
  </button>
  {#if isMaster}
    <SaveMasterVolumeButton />
  {/if}
</div>

<style>
  .vol {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-dim);
  }
  /* U-P3 policy B: no whole-widget dim when disconnected. The axis toggle and
     dB readout stay full-contrast; the range input and mute icon-toggle are
     disabled in that state and each carry the single dim layer themselves
     (icon-toggle via its own :disabled rule in controls.css). */
  input[type="range"] {
    width: 120px;
    accent-color: var(--accent);
    margin: 0;
    padding: 0;
  }
  /* MASTER axis reads as a distinct (vendor-only, OS-invisible) ceiling. */
  input[type="range"].master { accent-color: var(--err); }
  input[type="range"]:disabled { opacity: var(--dim-disabled); cursor: default; }
  input[type="range"].muted {
    accent-color: var(--text-faint);
    opacity: 0.45;
  }
  .axis-toggle {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .axis-toggle:hover { color: var(--text-dim); }
  .db {
    font-size: 11px;
    color: var(--text);
    font-weight: 600;
    min-width: 36px;
    text-align: right;
  }
  .db.muted {
    color: var(--text-faint);
    letter-spacing: 0.5px;
  }
  .mute { width: 24px; }
</style>
