import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import * as HuePins from './roomHuePins.svelte';

const KEY = 'dspi-console-web/room-hue-pins/v1';
const ACCENT = 265;

describe('room hue pin storage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  test('a pin survives a new session for the same device only', () => {
    HuePins.createRoomHuePins('A').set(3, 120);
    expect(HuePins.createRoomHuePins('A').get(3)).toBe(120);
    expect(HuePins.createRoomHuePins('A').get(4)).toBeNull();
    expect(HuePins.createRoomHuePins('B').get(3)).toBeNull();
  });

  test('unpinning one device leaves the other device untouched', () => {
    HuePins.createRoomHuePins('B').set(1, 40);
    const a = HuePins.createRoomHuePins('A');
    a.set(3, 120);
    a.set(3, null);
    expect(HuePins.createRoomHuePins('A').get(3)).toBeNull();
    expect(HuePins.createRoomHuePins('B').get(1)).toBe(40);
  });

  test('unreadable storage yields no pins', () => {
    localStorage.setItem(KEY, '{nope');
    expect(HuePins.createRoomHuePins('A').get(0)).toBeNull();
  });

  test('bad entries are dropped and out-of-range hues clamped', () => {
    localStorage.setItem(KEY, JSON.stringify({ A: { 0: 900, 1: 'red', 42: 10, x: 10 }, B: [1, 2] }));
    const a = HuePins.createRoomHuePins('A');
    expect(a.get(0)).toBe(360);
    expect(a.get(1)).toBeNull();
    a.set(2, 50);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ A: { 0: 360, 2: 50 } });
  });
});

describe('room hue pin actions', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  test('a release edits the pin on a pinned preset and the shared hue elsewhere', () => {
    const pins = HuePins.createRoomHuePins('A');
    const shared = { roomHue: 30 };
    pins.set(0, 100);
    HuePins.commitRoomHue(pins, shared, 0, 150);
    expect(pins.get(0)).toBe(150);
    expect(shared.roomHue).toBe(30);
    HuePins.commitRoomHue(pins, shared, 1, 200);
    expect(pins.get(1)).toBeNull();
    expect(shared.roomHue).toBe(200);
  });

  test('reset keeps a pinned preset pinned at the accent hue', () => {
    const pins = HuePins.createRoomHuePins('A');
    const shared = { roomHue: 30 };
    pins.set(0, 100);
    HuePins.resetRoomHue(pins, shared, 0, ACCENT);
    expect(pins.get(0)).toBe(ACCENT);
    expect(shared.roomHue).toBe(30);
    HuePins.resetRoomHue(pins, shared, 1, ACCENT);
    expect(shared.roomHue).toBeNull();
  });

  test('pinning captures the hue on screen; unpinning hands it to the shared hue', () => {
    const pins = HuePins.createRoomHuePins('A');
    const shared = { roomHue: 30 };
    HuePins.toggleRoomHuePin(pins, shared, 0, 30, ACCENT);
    expect(pins.get(0)).toBe(30);
    HuePins.commitRoomHue(pins, shared, 0, 100);
    HuePins.toggleRoomHuePin(pins, shared, 0, 100, ACCENT);
    expect(pins.get(0)).toBeNull();
    expect(shared.roomHue).toBe(100);
  });

  test('unpinning at the accent hue goes back to following the accent', () => {
    const pins = HuePins.createRoomHuePins('A');
    const shared = { roomHue: null };
    HuePins.toggleRoomHuePin(pins, shared, 0, ACCENT, ACCENT);
    HuePins.toggleRoomHuePin(pins, shared, 0, ACCENT, ACCENT);
    expect(shared.roomHue).toBeNull();
  });
});
