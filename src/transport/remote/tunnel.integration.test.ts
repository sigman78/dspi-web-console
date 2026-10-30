import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WireCmd } from '@/protocol/wireCmd';
import { DspDevice } from '@/device/DspDevice';
import { MockTransport } from '@/transport/MockTransport';
import { withSerializedCtrl } from '@/transport/withSerializedCtrl';
import { RemoteTransport } from './RemoteTransport';
import { startUsbProxy } from '@/runtime/remote/UsbProxy';
import { createLeasePolicy } from '@/runtime/remote/allowlist';
import { createFrameChannelPair } from '@test/fixtures/frameChannelPair';

describe('tunnel over MockTransport', () => {
  let mock: MockTransport;
  let direct: DspDevice;
  let remote: DspDevice;

  beforeEach(async () => {
    mock = new MockTransport({ platform: 'rp2350' });
    await mock.open();
    direct = await DspDevice.create(mock, async () => {});

    const [bSide, aSide] = createFrameChannelPair();
    startUsbProxy(withSerializedCtrl(mock), aSide, createLeasePolicy(false), {
      consoleBuild: 'test',
      onClosed: () => {},
    });
    const transport = await RemoteTransport.connect(bSide, { consoleBuild: 'test', wantReadOnly: false });
    remote = await DspDevice.create(transport, async () => {});
  });

  it('reads the same snapshot through the tunnel as directly', async () => {
    expect(remote.info.serial).toBe(direct.info.serial);
    expect(await remote.getSnapshot()).toEqual(await direct.getSnapshot());
  });

  it('reads each snapshot with exactly one chunked-read session', async () => {
    const spy = vi.spyOn(mock, 'ctrlIn');
    await remote.getSnapshot();
    const starts = spy.mock.calls.filter(([req, value]) => req === WireCmd.GetAllParamsChunk.code && value === 0);
    expect(starts).toHaveLength(1);
  });

  it('applies a write on the device behind the proxy', async () => {
    await remote.setMasterVolume(-12.5);
    expect((await direct.getSnapshot()).masterVolumeDb).toBeCloseTo(-12.5, 4);
  });

  it('delivers a queued notify packet', async () => {
    const packet = new Uint8Array([2, 0x05, 0, 1, 3, 0, 0, 0]);
    mock.pushNotify(packet);
    expect(await remote.readNotification()).toEqual(packet);
  });
});
