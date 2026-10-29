// Runs inside the page (Vite dev, ?mock): stages a demo 2.1 active-speaker setup
// on the live session through the app's own actions.
async () => {
  const St = await import('/src/state/index.ts');
  const Rt = await import('/src/runtime/index.ts');
  const D = await import('/src/domain/index.ts');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 200 && !St.activeSession(); i++) await sleep(100);
  const s = St.activeSession();
  if (!s) throw new Error('no session');

  const PK = 1, LS = 2, HS = 3, LR4_LP = 34, LR4_HP = 35, BW2_HP = 43;
  const f = (type, frequency, gain = 0, q = 0.707) => ({ type, bypass: false, frequency, q, gain });
  const outId = (slot) => 2 + slot;

  const names = ['Woofer L', 'Woofer R', 'Tweeter L', 'Tweeter R', 'Sub 1', 'Sub 2', 'Phones L', 'Phones R'];
  names.forEach((n, slot) => Rt.setChannelName(s, outId(slot), n));

  // Routing: stereo to woofers, tweeters and phones; summed mono to both subs.
  for (const slot of [0, 2, 6]) Rt.routeCrosspoint(s, 0, slot, { gainDb: 0, invert: false });
  for (const slot of [1, 3, 7]) Rt.routeCrosspoint(s, 1, slot, { gainDb: 0, invert: false });
  for (const slot of [4, 5]) {
    Rt.routeCrosspoint(s, 0, slot, { gainDb: -6, invert: false });
    Rt.routeCrosspoint(s, 1, slot, { gainDb: -6, invert: false });
  }

  // Woofers: room correction, an LR4 low-pass at 2.2 kHz and a subsonic high-pass.
  const wooferEq = [f(PK, 42, -5.5, 4.2), f(PK, 118, -3.2, 2.1), f(LS, 90, 2.5, 0.7), f(PK, 340, 1.6, 1.4), f(PK, 760, -1.8, 2.6), f(PK, 1450, 1.2, 1.8)];
  // Tweeters: baffle-step tilt and a soft top.
  const tweeterEq = [f(PK, 3100, -2.2, 2.4), f(PK, 6800, 1.4, 1.6), f(HS, 12000, -1.5, 0.7)];
  const subEq = [f(PK, 34, 3.5, 1.2), f(PK, 56, -4.5, 3.8)];
  for (const slot of [0, 1]) {
    wooferEq.forEach((b, i) => Rt.setEqFilter(s, outId(slot), i, slot === 1 ? { ...b, gain: b.gain * 0.85 } : b));
    Rt.setXoverBand(s, outId(slot), 0, f(LR4_LP, 2200));
    Rt.setXoverBand(s, outId(slot), 1, f(BW2_HP, 28));
  }
  for (const slot of [2, 3]) {
    tweeterEq.forEach((b, i) => Rt.setEqFilter(s, outId(slot), i, b));
    Rt.setXoverBand(s, outId(slot), 0, f(LR4_HP, 2200));
    Rt.setOutputGain(s, slot, -4.5);
    Rt.setOutputDelay(s, slot, 0.12);
  }
  for (const slot of [4, 5]) {
    subEq.forEach((b, i) => Rt.setEqFilter(s, outId(slot), i, b));
    Rt.setXoverBand(s, outId(slot), 0, f(LR4_LP, 80));
    Rt.setXoverBand(s, outId(slot), 1, f(BW2_HP, 18));
    Rt.setOutputDelay(s, slot, 2.4);
  }
  for (const slot of [0, 1, 4, 5]) {
    Rt.setLimiterEnabled(s, slot, true);
    Rt.setLimiterThreshold(s, slot, -3);
    Rt.setLimiterLinkGroup(s, slot, slot < 2 ? 1 : 2);
  }

  // Processors.
  Rt.setCrossfeedEnabled(s, true);
  Rt.setCrossfeedOutputPairs(s, 1 << 3);
  Rt.setLoudnessEnabled(s, true);
  Rt.setLoudnessOutputMask(s, 0b1111);
  Rt.setSubharmEnabled(s, true);
  Rt.setSubharmOutputMask(s, 0b110000);
  Rt.setSubharmLow(s, 6);
  Rt.setSubharmHigh(s, 4);
  Rt.setMasterVolume(s, -14);
  await sleep(1500);

  // Control surfaces: a volume knob, a preset button, a loudness LED and an IR remote.
  const cs = (o) => ({ ...D.EMPTY_CS_BINDING, flags: 0, gpio1: null, event: D.CsEvent.Press, target: 0, index: 0, value: 0, step: 0, rangeMin: 0, rangeMax: 0, baseBright: 0, onDelay: 0, offDelay: 0, ...o });
  const rig = [
    ['Volume', cs({ type: D.CsType.Encoder, noun: D.CsNoun.UserVolume, action: D.CsAction.Step, gpio0: 20, gpio1: 21, step: D.dbToQ8(1) })],
    ['Preset', cs({ type: D.CsType.Button, noun: D.CsNoun.Preset, action: D.CsAction.Inc, gpio0: 22 })],
    ['Mute', cs({ type: D.CsType.Button, noun: D.CsNoun.UserMute, action: D.CsAction.Toggle, gpio0: 22, event: D.CsEvent.Long })],
    ['Loudness', cs({ type: D.CsType.Led, noun: D.CsNoun.Loudness, action: D.CsAction.IndEquals, gpio0: 26, value: 1 })],
    ['Remote', cs({ type: D.CsType.Ir, noun: D.CsNoun.UserVolume, action: D.CsAction.Adjust, gpio0: 16 })],
  ];
  for (const [i, [name, b]] of rig.entries()) {
    if (!(await Rt.applyCsBinding(s, i, b))) console.warn('cs binding rejected', name);
    await Rt.applyCsName(s, i, name);
  }
  const ir = (noun, action, code, step = 0) => ({ noun, action, flags: 0, target: 0, index: 0, protocol: D.CsIrProto.Nec, value: 0, step, code });
  await Rt.applyCsIrCommand(s, 0, ir(D.CsNoun.UserVolume, D.CsAction.Inc, 0x20df40bf, D.dbToQ8(1)));
  await Rt.applyCsIrCommand(s, 1, ir(D.CsNoun.UserVolume, D.CsAction.Dec, 0x20dfc03f, D.dbToQ8(1)));
  await Rt.applyCsIrCommand(s, 2, ir(D.CsNoun.UserMute, D.CsAction.Toggle, 0x20df906f));
  await Rt.csSaveConfig(s);

  const presets = ['Living room', 'Movie night', 'Late night', 'Headphones', 'Vinyl'];
  for (let slot = presets.length - 1; slot >= 0; slot--) {
    await Rt.savePresetSlot(s, slot);
    await Rt.renamePresetSlot(s, slot, presets[slot]);
  }
  await Rt.loadPresetSlot(s, 0);
  await sleep(1000);
  return { active: s.presets.active, names: s.presets.names };
}
