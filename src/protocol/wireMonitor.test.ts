import { describe, it, expect, afterEach } from 'vitest';
import { Codec } from '@/utils';
import { WireCmd } from '@/protocol';
import * as Wire from '@/protocol/wireTypes';
import { NOTIFY_V2_VERSION, NotifyEventId, ParamSource } from '@/protocol/notify';
import {
  formatCtrlIn,
  formatCtrlOut,
  formatNotify,
  wireMonitorEnabled,
} from './wireMonitor';

describe('wireMonitor formatters', () => {
  it('renders a setter with a per-output wValue and f32 payload', () => {
    const data = Codec.encode(Codec.f32, 3.5);
    expect(formatCtrlOut(WireCmd.SetOutputGain.code, 2, data))
      .toBe('→ SetOutputGain w=0x2 3.50');
  });

  it('renders a bool setter as on/off', () => {
    const data = Codec.encode(Codec.bool8, true);
    expect(formatCtrlOut(WireCmd.SetBypass.code, 0, data))
      .toBe('→ SetBypass on');
  });

  it('renders an object-payload setter field-by-field', () => {
    const data = Codec.encode(Wire.SetFilterPacket, {
      channel: 0, band: 2, type: 0, frequency: 1000, q: 0.7, gain: 3,
    });
    expect(formatCtrlOut(WireCmd.SetEqParam.code, 0, data))
      .toBe('→ SetEqParam channel=0 band=2 type=0 frequency=1000 q=0.70 gain=3');
  });

  it('renders a getter response decoded via its codec', () => {
    const bytes = Codec.encode(Codec.f32, -12.5);
    expect(formatCtrlIn(WireCmd.GetMasterVolume.code, 0, bytes))
      .toBe('← GetMasterVolume -12.50');
  });

  it('renders a string getter quoted', () => {
    const bytes = Codec.encode(Wire.Serial, 'ABC');
    expect(formatCtrlIn(WireCmd.GetSerial.code, 0, bytes))
      .toBe('← GetSerial "ABC"');
  });

  it('renders a codec-less raw IN command as a byte count', () => {
    const bytes = new Uint8Array(20);
    expect(formatCtrlIn(WireCmd.GetStatus.code, 0, bytes))
      .toBe('← GetStatus 20 B');
  });

  it('renders a bulk read with format version and size', () => {
    const bytes = new Uint8Array(2896);
    bytes[0] = 6;
    expect(formatCtrlIn(WireCmd.GetAllParams.code, 0, bytes))
      .toBe('⇅ GetAllParams (bulk) v6 2896 B');
  });

  it('renders a bulk write with format version and size', () => {
    const data = new Uint8Array(2896);
    data[0] = 6;
    expect(formatCtrlOut(WireCmd.SetAllParams.code, 0, data))
      .toBe('⇅ SetAllParams (bulk) v6 2896 B');
  });

  it('renders an unknown code by hex with byte count', () => {
    expect(formatCtrlIn(0xee, 0, new Uint8Array(4)))
      .toBe('← 0xee 4 B');
  });

  it('decodes a paramChanged notification with a named source', () => {
    const pkt = new Uint8Array(12);
    pkt[0] = NOTIFY_V2_VERSION;
    pkt[1] = NotifyEventId.ParamChanged;
    pkt[3] = 5;                 // seq
    pkt[8] = ParamSource.Gpio;  // source
    expect(formatNotify(pkt)).toBe('↑ notify paramChanged seq=5 src=gpio');
  });

  it('suppresses idle keep-alives', () => {
    expect(formatNotify(new Uint8Array([0x00]))).toBeNull();
  });
});

describe('wireMonitorEnabled', () => {
  afterEach(() => window.history.replaceState({}, '', '/'));

  it('is true when ?debug is present', () => {
    window.history.replaceState({}, '', '/?debug');
    expect(wireMonitorEnabled()).toBe(true);
  });

  it('is false when ?debug is absent', () => {
    window.history.replaceState({}, '', '/');
    expect(wireMonitorEnabled()).toBe(false);
  });
});
