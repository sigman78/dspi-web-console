<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
  import KV from '@/components/chrome/KV.svelte';
  import { connection } from '@/state';
  import { setLgSoundSyncEnabled } from '@/runtime';
  import { getSession } from '@/components/sessionContext';

  const s = getSession();
  const connected = $derived(connection.connected);
  const lgs = $derived(s.mirror.current?.lgSoundSync ?? null);
  const enabled = $derived(lgs?.enabled ?? false);
</script>

<Panel code="SY.09" title="LG SOUND SYNC">
  {#if lgs !== null}
    <div class="kvgrid">
      <KV label="ENABLED" value={enabled ? 'YES' : 'NO'} tone={enabled ? 'ok' : 'off'} />
      <KV label="PRESENT" value={lgs.present ? 'YES' : 'NO'} tone={lgs.present ? 'ok' : 'off'} />
      <KV label="VOLUME"  value={`${lgs.volume}`} />
      <KV label="MUTED"   value={lgs.muted ? 'YES' : 'NO'} tone={lgs.muted ? undefined : 'off'} />
    </div>
    <div class="row">
      <button
        class="toggle"
        class:on={enabled}
        onclick={() => setLgSoundSyncEnabled(s, !enabled)}
        disabled={!connected}
      >{enabled ? 'DISABLE' : 'ENABLE'}</button>
    </div>
  {:else}
    <p class="na">Not available on this firmware.</p>
  {/if}
</Panel>

<style>
  .kvgrid { padding: 12px 14px 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .row { padding: 6px 14px 12px; }
  .toggle {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 3px 10px;
    border-radius: 3px;
    background: color-mix(in oklab, var(--text) 4%, transparent);
    border: 1px solid var(--border);
    color: var(--text-faint);
    cursor: pointer;
  }
  .toggle:hover:not(:disabled) { color: var(--text); border-color: var(--border-hi); }
  .toggle:disabled { opacity: 0.4; cursor: default; }
  .toggle.on {
    background: color-mix(in oklab, var(--ok) 12%, transparent);
    border-color: color-mix(in oklab, var(--ok) 50%, var(--border));
    color: var(--ok);
  }
  .na { font-family: var(--font-mono); font-size: 9px; color: var(--text-faint); padding: 12px 14px; margin: 0; }
</style>
