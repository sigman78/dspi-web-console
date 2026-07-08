<script lang="ts">
  import EqSpectrum from './EqSpectrum.svelte';
  import { connection, activeSession } from '@/state';
  import { connectRequested, webUsbUnsupportedReason } from '@/runtime';
  import { REPO_URL } from '@/buildInfo';

  let busy = $state(false);
  const unsupported = webUsbUnsupportedReason();

  const setupCmd = `curl -fsSL ${location.origin}${import.meta.env.BASE_URL}setup-linux.sh | sh`;
  let linuxOpen = $state(false);
  let copied = $state(false);

  async function copySetupCmd() {
    try {
      await navigator.clipboard.writeText(setupCmd);
      copied = true;
      setTimeout(() => { copied = false; }, 1500);
    } catch {
      // clipboard unavailable (permissions/insecure context); command stays selectable
    }
  }

  // Mirrors StatusPill.svelte's text/disabled derivation. Kept duplicated
  // (six lines of switch) rather than extracted; the two presentations may
  // diverge and an early shared module would be the wrong abstraction.
  const text = $derived.by(() => {
    if (unsupported) return 'WEBUSB UNAVAILABLE';
    switch (connection.phase) {
      case 'ready':      return `ONLINE · ${activeSession()?.device?.info.serial ?? ''}`;
      case 'connecting': return 'CONNECTING…';
      case 'errored':    return 'ERROR';
      case 'noDevice':   return 'WAITING FOR DEVICE…';
    }
  });

  const showUnsupportedFirmware = $derived(
    connection.errorKind === 'unsupported-firmware'
  );
  // Shown only after a real claim failure (errorKind === 'device-in-use'), so it
  // never appears when the device is simply unplugged (that path has no error).
  const showDeviceInUse = $derived(
    connection.errorKind === 'device-in-use'
  );
  const showErrorPanel = $derived(
    connection.error !== null && !showUnsupportedFirmware && !showDeviceInUse
  );

  const disabled = $derived(
    busy || unsupported !== null || connection.phase === 'connecting'
  );

  async function connect() {
    if (disabled) return;
    // 'connected' is intentionally NOT in the disabled predicate (button stays
    // live); the handler still no-ops so a stray click doesn't re-enter connect.
    if (connection.connected) return;
    busy = true;
    try {
      await connectRequested();
    } catch {
      // connectRequested already reported the failure with its errorKind.
    } finally {
      busy = false;
    }
  }
</script>

<div class="connecting-hero">
  <EqSpectrum />
  <div class="tagline">
    Web console for the DSPi audio processor — connects over USB, nothing leaves your machine.
  </div>
  <div class="status" class:is-error={connection.phase === 'errored'}>{text}</div>
  {#if unsupported}
    <div class="unsupported-panel alert-panel warn" role="alert" aria-label="WebUSB unavailable">
      <div class="alert-panel__header">WEBUSB UNAVAILABLE</div>
      <pre class="alert-panel__body">{unsupported}</pre>
    </div>
  {:else}
    {#if showUnsupportedFirmware}
      <div class="alert-panel warn" role="alert" aria-label="Firmware update required">
        <div class="alert-panel__header">FIRMWARE UPDATE REQUIRED</div>
        <pre class="alert-panel__body">{connection.error}</pre>
      </div>
    {:else if showDeviceInUse}
      <div class="held-panel alert-panel warn" role="alert" aria-label="Device in use">
        <div class="alert-panel__header">DEVICE IN USE</div>
        <div class="alert-panel__body alert-panel__body--rich">
          <p>Couldn't get exclusive access to the DSPi. Usually one of:</p>
          <ul class="causes">
            <li>It's already open in another browser tab or window.</li>
            <li>The DSPi Console desktop app is running — close it.</li>
            <li>Another program has the device open.</li>
            <li>On Windows, the USB interface isn't bound to WinUSB (run Zadig).</li>
          </ul>
          <p>Close whatever's using it, then click CONNECT to retry.</p>
        </div>
      </div>
    {/if}
    <button
      class="connect"
      onclick={connect}
      disabled={disabled}
      title={text}
    >
      CONNECT
    </button>
    {#if showErrorPanel}
      <div class="alert-panel" role="alert" aria-label="Connection error details">
        <div class="alert-panel__header">DIAGNOSTICS</div>
        <pre class="alert-panel__body">{connection.error}</pre>
      </div>
    {/if}
    {#if !connection.connected}
      <details class="linux-panel" bind:open={linuxOpen} aria-label="Linux USB setup">
        <summary>LINUX? ONE-TIME USB SETUP</summary>
        <div class="linux-panel__body">
          <p>
            Linux shows the DSPi in the USB picker but blocks opening it until a
            udev rule grants access. Run this once, then replug the device:
          </p>
          <div class="cmd-row">
            <code>{setupCmd}</code>
            <button class="copy" onclick={copySetupCmd}>{copied ? 'COPIED' : 'COPY'}</button>
          </div>
          <p class="fine">
            The script prints a diagnostics report and asks for sudo only if
            something needs changing. Prefer manual? Install
            <a href="{import.meta.env.BASE_URL}70-dspi.rules" download>70-dspi.rules</a>
            into /etc/udev/rules.d/ and run
            <code class="inline">udevadm control --reload</code>.
          </p>
        </div>
      </details>
    {/if}
  {/if}
  <div class="footer-links">
    <a href={REPO_URL} target="_blank" rel="noreferrer">OPEN SOURCE · GITHUB ↗</a>
    <span class="sep">·</span>
    <span>FIRMWARE 1.1.4+</span>
    <span class="sep">·</span>
    <span>CHROME / EDGE</span>
  </div>
</div>

<style>
  .connecting-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    font-family: var(--font-mono);
  }
  .tagline {
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--text-dim);
    max-width: min(520px, 90vw);
    text-align: center;
  }
  .status {
    font-size: 11px;
    letter-spacing: 2px;
    color: var(--accent);
  }
  .footer-links {
    margin-top: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 9px;
    letter-spacing: 1px;
    color: var(--text-faint);
  }
  .footer-links a {
    color: var(--text-faint);
    text-decoration: none;
  }
  .footer-links a:hover { color: var(--text); text-decoration: underline; }
  .sep { color: var(--border-hi); }
  .status.is-error {
    color: var(--err);
  }
  /* Diagnostics/warning callout. Default tone is --err; .warn swaps --tone
     to --warn (same pattern as .chip.warn in controls.css). */
  .alert-panel {
    --tone: var(--err);
    margin-top: 4px;
    width: min(640px, 90vw);
    border: 1px solid color-mix(in oklab, var(--tone) 55%, var(--border));
    background: color-mix(in oklab, var(--tone) 7%, var(--panel));
    border-radius: var(--radius);
    overflow: hidden;
    text-align: left;
  }
  .alert-panel.warn { --tone: var(--warn); }
  .alert-panel__header {
    padding: 6px 12px;
    font-size: 10px;
    letter-spacing: 2px;
    color: var(--tone);
    background: color-mix(in oklab, var(--tone) 10%, transparent);
    border-bottom: 1px solid color-mix(in oklab, var(--tone) 35%, var(--border));
  }
  .alert-panel__body {
    margin: 0;
    padding: 10px 12px;
    max-height: 240px;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    color: var(--text);
    white-space: pre-wrap;
    word-break: break-word;
  }
  /* Structured body (paragraphs + list) opts out of the raw-text pre-wrap so the
     template's own indentation/newlines don't render as stray whitespace. */
  .alert-panel__body--rich { white-space: normal; }
  .alert-panel__body p { margin: 0; }
  .causes {
    margin: 6px 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .causes li { color: var(--text-dim); }
  .linux-panel {
    margin-top: 4px;
    width: min(860px, 92vw);
    border: 1px solid var(--border);
    background: color-mix(in oklab, var(--panel) 60%, transparent);
    border-radius: var(--radius);
    text-align: left;
  }
  .linux-panel summary {
    padding: 8px 14px;
    font-size: 14px;
    letter-spacing: 2px;
    color: var(--text-dim);
    cursor: pointer;
    user-select: none;
    text-align: center;
  }
  .linux-panel summary:hover { color: var(--text); }
  .linux-panel[open] summary {
    border-bottom: 1px solid var(--border);
    color: var(--text);
  }
  .linux-panel__body {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .linux-panel__body p {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 15px;
    line-height: 1.5;
    color: var(--text-dim);
  }
  .linux-panel__body p.fine {
    font-size: 13px;
    color: var(--text-faint);
  }
  .linux-panel__body a { color: var(--accent); }
  .cmd-row {
    display: flex;
    align-items: stretch;
    gap: 6px;
  }
  .cmd-row code {
    flex: 1;
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 14px;
    color: var(--text);
    background: color-mix(in oklab, var(--accent) 6%, transparent);
    border: 1px solid var(--border);
    border-radius: 3px;
    overflow-x: auto;
    white-space: nowrap;
  }
  code.inline {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text);
  }
  .copy {
    padding: 0 14px;
    font-family: inherit;
    font-size: 12px;
    letter-spacing: 1px;
    color: var(--text-dim);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 3px;
    cursor: pointer;
  }
  .copy:hover { color: var(--text); border-color: var(--border-hi); }

  .connect {
    padding: 10px 26px;
    background: color-mix(in oklab, var(--accent) 12%, transparent);
    border: 1px solid var(--accent);
    color: var(--accent);
    font-family: inherit;
    font-size: 12px;
    letter-spacing: 2px;
    border-radius: 4px;
    cursor: pointer;
  }
  .connect:hover:not(:disabled) {
    background: color-mix(in oklab, var(--accent) 20%, transparent);
  }
  .connect:disabled {
    cursor: default;
    opacity: var(--dim-disabled);
  }
</style>
