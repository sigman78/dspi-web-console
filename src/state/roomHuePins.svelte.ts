// ROOM hue pinned to a preset slot, per device serial. A pinned preset shows
// its own hue; unpinned presets share settings.roomHue. Pins belong to the
// slot, like its name: they outlive PresetDelete and factory reset.

import { SvelteMap } from 'svelte/reactivity';
import { PRESET_SLOT_COUNT } from '@/domain';
import { hueOrNull } from './settings.svelte';

const STORAGE_KEY = 'dspi-console-web/room-hue-pins/v1';

type PinRecord = Record<string, Record<string, number>>;

export interface RoomHuePins {
  get(slot: number): number | null;
  // null unpins.
  set(slot: number, hue: number | null): void;
}

// The hue unpinned presets share; null follows the accent.
export interface SharedHue {
  roomHue: number | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isSlot(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < PRESET_SLOT_COUNT;
}

function readRecord(): PinRecord {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) return {};
    const out: PinRecord = {};
    for (const [serial, slots] of Object.entries(parsed)) {
      if (!isObject(slots)) continue;
      const pins: Record<string, number> = {};
      for (const [slot, value] of Object.entries(slots)) {
        const hue = hueOrNull(value);
        if (hue !== null && isSlot(Number(slot))) pins[slot] = hue;
      }
      out[serial] = pins;
    }
    return out;
  } catch {
    return {};
  }
}

function writeRecord(record: PinRecord): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable or full: the pin stays session-local.
  }
}

export function createRoomHuePins(serial: string): RoomHuePins {
  const pins = new SvelteMap<number, number>(
    Object.entries(readRecord()[serial] ?? {}).map(([slot, hue]) => [Number(slot), hue]),
  );

  return {
    get(slot) {
      return pins.get(slot) ?? null;
    },
    set(slot, hue) {
      if (hue === null) pins.delete(slot); else pins.set(slot, hue);
      const record = readRecord();
      if (pins.size > 0) record[serial] = Object.fromEntries(pins); else delete record[serial];
      writeRecord(record);
    },
  };
}

// A slider release edits the slot's pin when it has one, else the shared hue.
export function commitRoomHue(pins: RoomHuePins, shared: SharedHue, slot: number | null, deg: number): void {
  if (slot !== null && pins.get(slot) !== null) pins.set(slot, deg);
  else shared.roomHue = deg;
}

export function resetRoomHue(pins: RoomHuePins, shared: SharedHue, slot: number | null, defaultHue: number): void {
  if (slot !== null && pins.get(slot) !== null) pins.set(slot, defaultHue);
  else shared.roomHue = null;
}

// Pinning captures the hue on screen. Unpinning hands the pin to the shared
// hue so the colour stays; a pin at the accent's hue goes back to following it.
export function toggleRoomHuePin(pins: RoomHuePins, shared: SharedHue, slot: number, onScreen: number, defaultHue: number): void {
  const pin = pins.get(slot);
  if (pin === null) {
    pins.set(slot, onScreen);
    return;
  }
  shared.roomHue = pin === defaultHue ? null : pin;
  pins.set(slot, null);
}
