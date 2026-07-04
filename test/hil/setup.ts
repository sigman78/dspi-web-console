// Hardware-in-the-loop test helpers.
//
// Centralises the USB device acquisition, DspDevice construction, and
// state-restoration patterns used across every *.hil.test.ts file. The
// helpers are intentionally simple: HIL tests need a real device, real
// timing, and a way to leave the hardware in its original state -- no
// elaborate fixture machinery.
//
// Excluded from `npm run check` and from the default vitest run; only
// invoked via `npm run test:hil` against a connected DSPi.
//
// Environment flags (optional; HIL tests are opt-in):
// - HIL_DESTRUCTIVE: enables flash-writing preset tests (DspDevice.presets.hil.test.ts).
// - HIL_INVASIVE: enables audible/pipeline-side-effect tests like input-source switching
//   and DAC mute configuration (DspDevice.v114.hil.test.ts).

import { usb } from 'usb';
import { DspDevice } from '@/device/DspDevice';
import { NodeUsbTransport } from '@/transport/NodeUsbTransport';
import { DSPI_USB_IDS, matchesDspi } from '@/transport/WebUsbTransport';
import type { BulkParams } from '@/protocol';

// Open the single DSPi attached to this host. Throws if zero or more
// than one device is present -- HIL is a single-device protocol; tests
// should run on a clean bench, not against an indeterminate pool.
//
// Returns the constructed DspDevice plus a close() callback that
// releases the USB interface and clears the libusb handle. Callers
// invoke close() from afterAll so the next test file can reclaim
// the device.
export async function openSingleDevice(): Promise<{
  device: DspDevice;
  close: () => Promise<void>;
}> {
  // Match any supported DSPi identity, not a single hardcoded pair: the
  // firmware changed its USB Vendor ID at 1.1.4 (0x2E8A -> 0x2E8B), so a
  // 1.1.4+ device on the bench enumerates under the newer VID. matchesDspi
  // is the same family check the WebUSB picker uses.
  const all = usb.getDeviceList().filter((d) =>
    matchesDspi({ vendorId: d.deviceDescriptor.idVendor, productId: d.deviceDescriptor.idProduct }),
  );
  if (all.length === 0) {
    const wanted = DSPI_USB_IDS
      .map((id) => `0x${id.vendorId.toString(16)}:0x${id.productId.toString(16)}`)
      .join(', ');
    throw new Error(`No DSPi device found (looked for ${wanted}). Connect a device and rerun.`);
  }
  // Guard against multiple-device benches -- picking the first match would
  // be racy across reruns. Better to fail loudly.
  if (all.length > 1) {
    throw new Error(`Found ${all.length} DSPi devices; HIL requires exactly one.`);
  }

  const transport = new NodeUsbTransport(all[0]);
  const device = await DspDevice.create(transport);

  return {
    device,
    close: async () => {
      await device.close();
    },
  };
}

// Quick guard for tests that exercise features only present from a
// given firmware wire-format version. Returns true if the device's
// bulk packet meets or exceeds the requested version. Use as an
// early `return` inside a test rather than skipping the whole file:
//   if (!hasFormatVersion(bulk0, 6)) return;
export function hasFormatVersion(bulk: BulkParams, minVersion: number): boolean {
  return bulk.formatVersion >= minVersion;
}

// Read a scalar device field, run the test body, then restore the
// original value -- even if the body throws. Used by roundtrip tests
// that mutate a single field via Set* commands and need the device
// left in its pre-test state. The read/write pair is generic so the
// helper works for any get/set field shape (numbers, booleans, enums).
export async function withSavedField<T>(
  read: () => Promise<T>,
  write: (value: T) => Promise<void>,
  body: () => Promise<void>,
): Promise<void> {
  const saved = await read();
  try {
    await body();
  } finally {
    await write(saved);
  }
}
