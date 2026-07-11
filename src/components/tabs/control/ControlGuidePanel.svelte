<script lang="ts">
  import Panel from '@/components/chrome/Panel.svelte';
</script>

<Panel code="CT.03" title="GUIDE">
  <div class="body">
    <div class="sect">
      <div class="microlbl">CONTROL INTERFACES</div>
      <div class="hint">
        UART and I2C expose the same control protocol as USB — an external MCU
        or remote can adjust volume, presets and processing. TX/RX and SDA/SCL
        ride adjacent pins on the same peripheral instance. Enabling an
        interface reserves its pins device-wide.
      </div>
    </div>
    <div class="sect">
      <div class="microlbl">CONTROL SURFACES</div>
      <div class="hint">
        Bind physical controls on spare GPIOs — no external MCU needed. Up to 16
        bindings, applied live as a preview: save to write them to the device,
        where they survive preset changes and factory reset.
      </div>
    </div>
    <div class="sect">
      <div class="microlbl">WIRING</div>
      <div class="hint">
        Buttons and switches wire between the GPIO and GND (internal pull-up).
        Pots use an ADC pin (GPIO 26–28) between 3V3 and GND, wiper to the pin.
        Encoders use two GPIOs with the common terminal to GND. LEDs drive
        active-high by default; each option has an inversion toggle for the
        opposite wiring.
      </div>
    </div>
    <div class="sect">
      <div class="microlbl">CONFLICTS</div>
      <div class="hint">
        Pins claimed by outputs, clocks, inputs or interfaces are shown taken
        in every picker. A binding whose pin is taken at boot stays stored but
        inactive until reassigned.
      </div>
    </div>
  </div>
</Panel>

<style>
  .body {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .sect { display: flex; flex-direction: column; gap: 4px; }
  .sect .hint {
    font-family: var(--font-sans);
    font-size: 10px;
    line-height: 1.5;
  }
</style>
