// Paged-firmware (1.1.7+) implementations of the console reads and writes whose
// 1.1.6 opcode has no one-to-one paged command. Each function returns exactly
// what the DspDevice method returned on 1.1.6; DspDevice picks them on a paged
// connection.

import * as proto from '@/protocol';
import { Codec, type BinCodec } from '@/utils';
import * as Domain from '@/domain';
import { StatusFamily } from '@/protocol/legacyMap.gen';

type Wire = proto.ExclusiveTransport;

const { Cmd } = proto;

// A band write waits behind the one device-wide pending slot. The resend and
// the LAST_RESULT read already span the main loop's 1-2 ms apply, so no timer
// delay (hidden tabs throttle timers to a second or more).
const BAND_BUSY = { busyRetries: 10, busyDelayMs: 0 } as const;

// ---- Status structs ----

export async function getLevels(t: Wire, numCh: number): Promise<proto.SystemStatus> {
  const bytes = await proto.pagedGet(t, Cmd.Levels.paged.get, 0, proto.systemStatusSize(numCh));
  return proto.parseSystemStatus(bytes, numCh);
}

// Reads a whole fixed-size struct.
async function readStruct<T>(
  t: Wire, c: { readonly codec: BinCodec<T>; readonly paged: { readonly get: number } },
): Promise<T> {
  return Codec.decodePadded(c.codec, await proto.pagedGet(t, c.paged.get, 0, Codec.sizeOf(c.codec)));
}

// One struct per source; a source that fails leaves its fields null, as one
// failed scalar read did on 1.1.6.
export async function getSystemInfo(t: Wire): Promise<proto.PartialSystemInfo> {
  const [sys, pdm, tx] = await Promise.allSettled([
    readStruct(t, Cmd.SystemStatus),
    readStruct(t, Cmd.PdmStats),
    readStruct(t, Cmd.SpdifTxStats),
  ]);
  const sysV = sys.status === 'fulfilled' ? sys.value : null;
  const pdmV = pdm.status === 'fulfilled' ? pdm.value : null;
  const txV = tx.status === 'fulfilled' ? tx.value : null;
  return {
    clockHz:               sysV?.clockHz ?? null,
    coreVoltageMv:         sysV?.coreVoltageMv ?? null,
    sampleRateHz:          sysV?.sampleRateHz ?? null,
    tempCDegC:             sysV?.tempCDegC ?? null,
    pdmRingOverruns:       pdmV?.ringOverruns ?? null,
    pdmRingUnderruns:      pdmV?.ringUnderruns ?? null,
    pdmDmaOverruns:        pdmV?.dmaOverruns ?? null,
    pdmDmaUnderruns:       pdmV?.dmaUnderruns ?? null,
    // 1.1.6 selector 7 (overruns) is retired and always read 0.
    spdifOverruns:         0,
    spdifUnderruns:        txV?.spdifUnderruns ?? null,
    spdifStarvationsTotal: txV?.starvationsTotal ?? null,
  };
}

export async function getRingHealth(t: Wire): Promise<Domain.RingHealth> {
  const [pipe, usb] = await Promise.allSettled([
    readStruct(t, Cmd.PipelineStats),
    readStruct(t, Cmd.UsbAudioStatus),
  ]);
  const p = pipe.status === 'fulfilled' ? pipe.value : null;
  const u = usb.status === 'fulfilled' ? usb.value : null;
  return {
    underrunEpisodes:     p?.underrunEpisodes ?? null,
    blocksRefused:        p?.blocksRefused ?? null,
    lowestFillFrames:     p?.lowestFillFrames ?? null,
    inputGapWorstUs:      p?.inputGapWorstUs ?? null,
    usbPacketGapWorstUs:  u?.worstGapUs ?? null,
    backgroundOverBudget: p?.backgroundOverBudget ?? null,
  };
}

export async function clearClips(t: Wire): Promise<void> {
  // 1.1.6 also answered the flags, which no caller used, so the read is skipped.
  await proto.pagedSet(t, Cmd.ClipClear.paged.set, 0, new Uint8Array(0));
}

// ---- EQ band ----

const bandAddress = (wireChannel: number, band: number): number => ((wireChannel & 0xFF) << 8) | (band & 0xFF);

// Reads the stored band. Unlike the 1.1.6 per-parameter getter, which reported
// bypass false, this carries the band's real bypass.
export async function getFilter(t: Wire, wireChannel: number, band: number): Promise<Domain.FilterParams> {
  const b = Codec.decodePadded(Cmd.EqBand.codec, await proto.pagedGet(
    t, Cmd.EqBand.paged.get, bandAddress(wireChannel, band), Codec.sizeOf(Cmd.EqBand.codec),
  ));
  const type = b.type as Domain.FilterType;
  const out: Domain.FilterParams = { type, bypass: b.bypass === 1, frequency: b.frequency, q: b.q, gain: b.gain };
  if (type === Domain.FilterType.LinkwitzTransform) out.qp = Domain.decodeQp(b.qp);
  return out;
}

// Writes the whole band, always with its Qp: the device stores what is sent
// and keeps no Qp across a write. The write carries p.bypass, so a caller that
// means to leave the band's bypass alone passes the band's own.
export async function setFilter(t: Wire, wireChannel: number, band: number, p: Domain.FilterParams): Promise<void> {
  const qp = p.type === Domain.FilterType.LinkwitzTransform ? Domain.encodeQp(p.qp ?? Domain.QP_DEFAULT) : 0;
  const bytes = Codec.encode(Cmd.EqBand.codec, {
    type: p.type, bypass: p.bypass ? 1 : 0, qp, frequency: p.frequency, q: p.q, gain: p.gain,
  });
  await proto.pagedSet(t, Cmd.EqBand.paged.set, bandAddress(wireChannel, band), bytes, BAND_BUSY);
}

// FILTER.BAND_BYPASS shares the band write's pending slot.
export async function setBandBypass(t: Wire, wireChannel: number, band: number, bypassed: boolean): Promise<void> {
  await proto.pagedSet(
    t, Cmd.BandBypass.paged.set, bandAddress(wireChannel, band), Codec.encode(Cmd.BandBypass.codec, bypassed), BAND_BUSY,
  );
}

// ---- Matrix ----

const crosspointAddress = (input: number, output: number): number => ((input & 0xFF) << 8) | (output & 0xFF);

export async function getMatrixRoute(
  t: Wire, input: number, output: number,
): Promise<{ enabled: boolean; invert: boolean; gainDb: number }> {
  const r = Codec.decodePadded(Cmd.Crosspoint.codec, await proto.pagedGet(
    t, Cmd.Crosspoint.paged.get, crosspointAddress(input, output), Codec.sizeOf(Cmd.Crosspoint.codec),
  ));
  return { enabled: r.enabled, invert: r.phaseInvert, gainDb: r.gainDb };
}

export async function setMatrixRoute(
  t: Wire, input: number, output: number, p: { enabled: boolean; invert: boolean; gainDb: number },
): Promise<void> {
  const bytes = Codec.encode(Cmd.Crosspoint.codec, { enabled: p.enabled, phaseInvert: p.invert, gainDb: p.gainDb });
  await proto.pagedSet(t, Cmd.Crosspoint.paged.set, crosspointAddress(input, output), bytes);
}

// ---- Preamp ----

// The 1.1.6 master preamp wrote the same gain to every input channel.
export async function setMasterPreamp(t: Wire, inputCount: number, db: number): Promise<void> {
  const bytes = Codec.encode(Codec.f32, db);
  for (let input = 0; input < inputCount; input++) {
    await proto.pagedSet(t, Cmd.Preamp.paged.set, input, bytes);
  }
}

// ---- Startup ----

export async function getPresetStartup(t: Wire): Promise<{ mode: number; slot: number }> {
  return Codec.decodePadded(Cmd.PresetStartup.codec, await proto.pagedGet(
    t, Cmd.PresetStartup.paged.get, 0, Codec.sizeOf(Cmd.PresetStartup.codec),
  ));
}

export async function setPresetStartup(t: Wire, config: { mode: number; slot: number }): Promise<void> {
  await proto.pagedSet(t, Cmd.PresetStartup.paged.set, 0, Codec.encode(Cmd.PresetStartup.codec, config));
}

// ---- Input rate ----

export async function getInputRate(t: Wire): Promise<{ currentHz: number; selectedHz: number }> {
  const [sys, selected] = await Promise.all([
    readStruct(t, Cmd.SystemStatus),
    proto.pagedGet(t, Cmd.InputRate.paged.get, 0, Codec.sizeOf(Cmd.InputRate.codec)),
  ]);
  return { currentHz: sys.sampleRateHz, selectedHz: Codec.decodePadded(Cmd.InputRate.codec, selected) };
}

export async function setInputRate(t: Wire, hz: number): Promise<void> {
  await proto.pagedSet(t, Cmd.InputRate.paged.set, 0, Codec.encode(Cmd.InputRate.codec, hz));
}

// ---- Control Surfaces display ----

export async function getCsDisplayCfg(t: Wire) {
  const [caps, cfg] = await Promise.all([
    proto.pagedGet(t, Cmd.CsDisplayCaps.paged.get, 0, Codec.sizeOf(Cmd.CsDisplayCaps.codec)),
    proto.pagedGet(t, Cmd.CsDisplayCfg.paged.get, 0, Codec.sizeOf(Cmd.CsDisplayCfg.codec)),
  ]);
  return {
    ...Codec.decodePadded(Cmd.CsDisplayCaps.codec, caps),
    cfg: Codec.decodePadded(Cmd.CsDisplayCfg.codec, cfg),
  };
}

// ---- S/PDIF input block ----

const pinStatusFor = (err: unknown): number => {
  if (err instanceof proto.CommandRefused) {
    const hit = StatusFamily.pin.fromVc.find(([vc]) => vc === err.vc);
    if (hit) return hit[1];
  }
  throw err;
};

// Selectable S/PDIF inputs 1..3 are one block: input k is on while the block
// switch is on and k < count, so the inputs are contiguous. Enabling k turns
// on every input below it too, and disabling k also drops every input above
// it. Input 0 is always on. Returns the 1.1.6 PinConfigResult byte.
export async function setSpdifInputEnabled(t: Wire, index: number, on: boolean): Promise<number> {
  const ok = StatusFamily.pin.success;
  const invalidOutput = 3;
  if (index === 0) return on ? ok : invalidOutput;
  if (index >= Domain.SPDIF_RX_MAX_INSTANCES) return invalidOutput;
  try {
    const count = Codec.decodePadded(Cmd.SpdifRxCount.codec, await proto.pagedGet(
      t, Cmd.SpdifRxCount.paged.get, 0, Codec.sizeOf(Cmd.SpdifRxCount.codec),
    ));
    const wanted = on ? Math.max(count, index + 1) : Math.min(count, index);
    if (wanted !== count) {
      await proto.pagedSet(t, Cmd.SpdifRxCount.paged.set, 0, Codec.encode(Cmd.SpdifRxCount.codec, wanted));
    }
    if (on) {
      try {
        await proto.pagedSet(t, Cmd.SpdifRxEnable.paged.set, 0, Codec.encode(Cmd.SpdifRxEnable.codec, 1));
      } catch (err) {
        // Put the previous count back; a failed restore keeps the original error.
        if (wanted !== count) {
          await proto.pagedSet(t, Cmd.SpdifRxCount.paged.set, 0, Codec.encode(Cmd.SpdifRxCount.codec, count)).catch(() => {});
        }
        throw err;
      }
    }
    return ok;
  } catch (err) {
    return pinStatusFor(err);
  }
}

// The 1.1.6 shape: the input limit, a mask with bit k set for each enabled
// input (none while the block switch is off), and the GPIO of each input.
export async function getSpdifInputConfig(t: Wire): Promise<{ count: number; enableMask: number; pins: number[] }> {
  const cfg = await readStruct(t, Cmd.SpdifRxConfig);
  const blockCount = Math.min(cfg.count, Domain.SPDIF_RX_MAX_INSTANCES);
  return { count: cfg.limit, enableMask: cfg.enabled ? (1 << blockCount) - 1 : 0, pins: cfg.pins };
}
