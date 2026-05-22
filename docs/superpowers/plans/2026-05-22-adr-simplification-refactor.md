# ADR-2026-05-22 Simplification Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the DSP write architecture from "two parallel write systems with seven coordination mechanisms" onto one pipeline with one set of primitives, removing concepts the maintainer must hold in their head — while preserving glitch-free audio behavior and HIL test coverage.

**Architecture:** Ports-and-adapters core. UI calls a flat, uniform set of action verbs; each verb mutates one optimistic snapshot and (eventually) enqueues a typed write intent into a single outbox; the device adapter speaks snapshots, never wire packets. Delivered as six interlocking ADRs, sequenced so `master` stays shippable at every step.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest, WebUSB single-device transport, V6 wire protocol (all fixed — not in scope).

**Source documents:** `ADN-2026-05-22.md` (the six ADRs), `BOARD_REVIEW-2026-05-22.md` (action items A1–A5), `docs/ARCH.md` (current write model).

---

## Resolved open questions

The ADR closed with three open questions. All three are now settled:

1. **Outbox policy granularity** — RESOLVED: a *static* per-control policy `{ strategy: 'granular' | 'bulk', coalesceKey?, debounceMs?, converge: 'resync' | 'self' }` is sufficient. Verified that no control switches strategy by context: `flushPending()` (`src/runtime/outbox.ts`) only sequences drains before preset flash; it never swaps a control's lane. The one nuance the policy MUST encode is convergence: granular sends schedule a trailing resync; bulk sends self-converge from their own packet. (See ADR-001 / Phase 4.)

2. **HIL dependency map** — RESOLVED. Runtime-facing `DspDevice` methods and test/HIL-only methods are fully enumerated (see Phase 5). Bonus: several granular setters are dead *even to tests* and can be deleted outright: `setCrossfeedEnabled`, `setCrossfeedItd`, `setCrossfeedFreq`, `setCrossfeedFeedDb`, `setLevellerEnabled`, `setLevellerLookahead`, `setLevellerMaxGain`, `setLevellerGate`, and `close`.

3. **Migration risk appetite** — RESOLVED: single integration branch `refactor/adr-2026-05-22-simplify` (already created), incremental commits/PRs per ADR keeping `master` shippable at each step, full test suite (`npm run check && npm test`) as the gate at each phase boundary. **No feature flag** (YAGNI — branch isolation already provides the safety net).

---

## Master roadmap

The ADRs interlock. This is the execution order; each phase ends shippable and gated.

| Phase | ADR(s) | Scope summary | Depends on | Risk |
|---|---|---|---|---|
| **0** | — | Confirm baseline green; branch exists | — | none |
| **1** | **006** + **004** | Uniform verb contract (`setX(enabled)`, typed `Result`, `dismissPresetActionError()`); single clamp choke point at action boundary; delete dead `validation.ts` | 0 | low |
| **2** | **003** | `DspDevice` owns snapshot⇄wire mapping + enum narrowing + format-version; expose `getSnapshot()` / `applyBulk(draft)` / `applyWrite(intent)`; runtime stops touching `BulkParams` | 1 | med |
| **3** | **002** | Shrink store from `live`/`shadow`/`wireBase` → `draft`/`saved`; `wireBase` moves inside adapter; cells become module-private behind readonly view + verbs | 2 | med |
| **4** | **001** | Replace `commands.ts` + `commit.ts` + `outbox.ts` + `focus.ts` with one `outbox` + `controlPolicy` table; policy carries strategy **and** convergence | 2, 3 | **high** |
| **5** | **005** | Split runtime-facing `DspDevice` from HIL-only granular facade; delete the truly-dead setters | 2 | low |

**Per-phase gate (MANDATORY before merging a phase):**
```bash
npm run check      # svelte-check + tsc, expect: 0 errors
npm test           # vitest run, expect: all pass
npm run test:hil   # HIL suite, expect: all pass (esp. after Phase 5)
npm run lint       # eslint, expect: clean
```

**Detailed task-level plans:** Phase 1 is fully specified below. Phases 2–5 are specified at roadmap granularity here; **each gets its own detailed TDD plan authored at the start of that phase**, because the exact code shape of a later phase depends on what its predecessor leaves behind (e.g. ADR-001's outbox is written against the `draft`/`saved` store and snapshot adapter that Phases 2–3 produce). Writing literal code for Phase 4 now would be fiction.

---

# PHASE 1 — ADR-006 (verb contract) + ADR-004 (clamp choke point)

These two ADRs are mechanical, independent of each other, and the ADR flags them as the good first PRs. Do ADR-004 first (it's self-contained), then ADR-006.

**File structure for Phase 1:**
- Create: `src/domain/clamp.ts` — pure clamp functions (the choke point's logic), one source of truth for ranges.
- Create: `src/domain/clamp.test.ts` — unit tests for clamp behavior.
- Delete: `src/domain/validation.ts` + `src/domain/validation.test.ts` — the dead validator it replaces.
- Modify: `src/runtime/actions.ts` — wire clamps into numeric verbs; rename `toggle*` → `set*(enabled)`.
- Modify: `src/runtime/presets.ts` — add `dismissPresetActionError()`; normalize record-only verbs to typed `Result`.
- Modify: `src/components/tabs/PresetsTab.svelte:59` — call `dismissPresetActionError()` instead of writing store state.
- Modify: UI call sites of renamed `toggle*` verbs (swept by grep).

---

## ADR-004 — Clamp choke point

### Task 1: Create the clamp module

**Files:**
- Create: `src/domain/clamp.ts`
- Test: `src/domain/clamp.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/domain/clamp.test.ts
import { describe, it, expect } from 'vitest';
import {
  clampToRange,
  clampMasterVolumeDb,
  clampBandGainDb,
  clampBandFrequencyHz,
  clampBandQ,
  clampPreampDb,
  clampOutputGainDb,
  clampOutputDelayMs,
  clampCrosspointGainDb,
  clampLoudnessRefSpl,
  clampLoudnessIntensityPct,
  clampCrossfeedFreqHz,
  clampCrossfeedFeedDb,
  clampLevellerAmountPct,
  clampLevellerMaxGainDb,
  clampLevellerGateDb,
  clampNameToByteBudget,
} from './clamp';
import { CHANNEL_NAME_MAX_LEN } from './presetLimits';

describe('clampToRange', () => {
  it('passes through in-range values', () => {
    expect(clampToRange(5, 0, 10)).toBe(5);
  });
  it('clamps below min and above max', () => {
    expect(clampToRange(-3, 0, 10)).toBe(0);
    expect(clampToRange(99, 0, 10)).toBe(10);
  });
  it('coerces non-finite to min', () => {
    expect(clampToRange(NaN, 0, 10)).toBe(0);
    expect(clampToRange(Infinity, 0, 10)).toBe(10);
  });
});

describe('named clampers use the domain limits', () => {
  it('master volume clamps to [-60, 0]', () => {
    expect(clampMasterVolumeDb(5)).toBe(0);
    expect(clampMasterVolumeDb(-99)).toBe(-60);
    expect(clampMasterVolumeDb(-12)).toBe(-12);
  });
  it('band gain clamps to [-24, 24]', () => {
    expect(clampBandGainDb(30)).toBe(24);
    expect(clampBandGainDb(-30)).toBe(-24);
  });
  it('output delay clamps to [0, 170]', () => {
    expect(clampOutputDelayMs(-5)).toBe(0);
    expect(clampOutputDelayMs(999)).toBe(170);
  });
});

describe('clampNameToByteBudget truncates on UTF-8 byte budget', () => {
  it('passes short ASCII names through', () => {
    expect(clampNameToByteBudget('Left', CHANNEL_NAME_MAX_LEN)).toBe('Left');
  });
  it('never returns more than the byte budget', () => {
    const long = 'x'.repeat(100);
    const out = clampNameToByteBudget(long, CHANNEL_NAME_MAX_LEN);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(CHANNEL_NAME_MAX_LEN);
  });
  it('does not split a multi-byte codepoint', () => {
    const out = clampNameToByteBudget('é'.repeat(40), CHANNEL_NAME_MAX_LEN);
    // valid UTF-8 round-trips without replacement chars
    expect(out).toBe(new TextDecoder('utf-8', { fatal: false }).decode(new TextEncoder().encode(out)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/clamp.test.ts`
Expected: FAIL — `Cannot find module './clamp'`.

- [ ] **Step 3: Write the clamp module**

```ts
// src/domain/clamp.ts
// Single clamp choke point for DSP write values. Clamps (never rejects),
// matching the existing ValueField UX. This is the one authoritative
// host-side source of write ranges; UI panels keep affordances only.
//
// Ranges mirror the (now-deleted) validation.ts. When ADR-003 lands and
// the device adapter exposes authoritative per-platform limits, these
// constants should be re-sourced from the adapter (board review A2).

import * as Eq from './eqLimits';
import * as Mix from './mixerLimits';
import { utf8ByteLength } from '@/utils';

export function clampToRange(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return v > 0 ? max : min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

// Master volume: UI exposes [-60, 0]. NOTE: the internal mute path writes
// MUTE_DB (-128) through _setMasterVolume and must NOT be clamped — only the
// public setMasterVolume(db) user-input path calls this.
export const MASTER_VOLUME_MIN_DB = -60;
export const MASTER_VOLUME_MAX_DB = 0;
export const clampMasterVolumeDb = (db: number) =>
  clampToRange(db, MASTER_VOLUME_MIN_DB, MASTER_VOLUME_MAX_DB);

export const clampBandFrequencyHz = (hz: number) =>
  clampToRange(hz, Eq.FREQ_MIN_HZ, Eq.FREQ_MAX_HZ);
export const clampBandQ = (q: number) =>
  clampToRange(q, Eq.Q_MIN, Eq.Q_MAX);
export const clampBandGainDb = (db: number) =>
  clampToRange(db, Eq.BAND_GAIN_MIN_DB, Eq.BAND_GAIN_MAX_DB);
export const clampPreampDb = (db: number) =>
  clampToRange(db, Eq.PREAMP_MIN_DB, Eq.PREAMP_MAX_DB);

export const clampOutputGainDb = (db: number) =>
  clampToRange(db, Mix.OUTPUT_GAIN_MIN_DB, Mix.OUTPUT_GAIN_MAX_DB);
export const clampOutputDelayMs = (ms: number) =>
  clampToRange(ms, Mix.OUTPUT_DELAY_MIN_MS, Mix.OUTPUT_DELAY_MAX_MS);
export const clampCrosspointGainDb = (db: number) =>
  clampToRange(db, Mix.CROSSPOINT_GAIN_MIN_DB, Mix.CROSSPOINT_GAIN_MAX_DB);

// Processing module ranges (mirrored from validation.ts).
export const clampLoudnessRefSpl = (db: number) => clampToRange(db, 40, 100);
export const clampLoudnessIntensityPct = (p: number) => clampToRange(p, 0, 200);
export const clampCrossfeedFreqHz = (hz: number) => clampToRange(hz, 500, 2000);
export const clampCrossfeedFeedDb = (db: number) => clampToRange(db, 0, 15);
export const clampLevellerAmountPct = (p: number) => clampToRange(p, 0, 100);
export const clampLevellerMaxGainDb = (db: number) => clampToRange(db, 0, 35);
export const clampLevellerGateDb = (db: number) => clampToRange(db, -96, 0);

// Names are encoded into a fixed NUL-terminated wire buffer. Truncate on the
// UTF-8 byte budget without splitting a codepoint. Clamping (not rejecting)
// here closes the channel-name false-dirty hazard (board review D-6): the
// optimistic snapshot stores exactly what the wire will hold.
export function clampNameToByteBudget(name: string, maxBytes: number): string {
  if (utf8ByteLength(name) <= maxBytes) return name;
  let out = '';
  for (const ch of name) {
    if (utf8ByteLength(out + ch) > maxBytes) break;
    out += ch;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/clamp.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/domain/clamp.ts src/domain/clamp.test.ts
git commit -m "feat(domain): add clamp choke-point module (ADR-004)"
```

### Task 2: Wire clamps into the numeric action verbs

**Files:**
- Modify: `src/runtime/actions.ts`

Each numeric/string write verb clamps its argument as the FIRST line, before any optimistic patch. This is the single host-side gate. The mute path (`_setMasterVolume`, called with `MUTE_DB`) is intentionally NOT clamped.

- [ ] **Step 1: Add the import**

At the top of `src/runtime/actions.ts`, add:
```ts
import {
  clampMasterVolumeDb, clampPreampDb, clampBandGainDb, clampBandFrequencyHz,
  clampBandQ, clampOutputGainDb, clampOutputDelayMs, clampCrosspointGainDb,
  clampLoudnessRefSpl, clampLoudnessIntensityPct, clampCrossfeedFreqHz,
  clampCrossfeedFeedDb, clampLevellerAmountPct, clampLevellerMaxGainDb,
  clampLevellerGateDb, clampNameToByteBudget,
} from '@/domain/clamp';
import { CHANNEL_NAME_MAX_LEN } from '@/domain';
```

- [ ] **Step 2: Clamp at each verb's entry**

Apply these exact edits (clamp the incoming value, then use the clamped value everywhere in the body):

- `setMasterVolume(db)` (public, `actions.ts:316`): first line `db = clampMasterVolumeDb(db);`. Do **not** touch `_setMasterVolume` or `toggleMute`/`reconcileAfterSync` (those use `MUTE_DB`).
- `setMasterPreamp(db)` (`:159`): first line `db = clampPreampDb(db);`.
- `setInputPreamp(channel, db)` (`:167`): after the `cur` guard, `db = clampPreampDb(db);`.
- `setEqFilter(channel, band, filter)` (`:39`): clamp the filter fields — replace the `commitBulk` body's `c.filters[band] = { ...filter };` with:
  ```ts
  c.filters[band] = {
    ...filter,
    freq: clampBandFrequencyHz(filter.freq),
    q: clampBandQ(filter.q),
    gainDb: clampBandGainDb(filter.gainDb),
  };
  ```
- `setOutputGain(slot, gainDb)` (`:217`): first line after the guard `gainDb = clampOutputGainDb(gainDb);`.
- `setOutputDelay(slot, delayMs)` (`:227`): first line after the guard `delayMs = clampOutputDelayMs(delayMs);`.
- `setCrosspointGain(input, output, gainDb)` (`:205`): `gainDb = clampCrosspointGainDb(gainDb);` before the call.
- `setLoudnessRefSpl(db)` (`:107`): `db = clampLoudnessRefSpl(db);`.
- `setLoudnessIntensityPct(pct)` (`:111`): `pct = clampLoudnessIntensityPct(pct);`.
- `setCrossfeedFreq(hz)` (`:127`): `hz = clampCrossfeedFreqHz(hz);`.
- `setCrossfeedFeedDb(db)` (`:131`): `db = clampCrossfeedFeedDb(db);`.
- `setLevellerAmount(pct)` (`:147`): `pct = clampLevellerAmountPct(pct);`.
- `setLevellerMaxGain(db)` (`:151`): `db = clampLevellerMaxGainDb(db);`.
- `setLevellerGate(db)` (`:155`): `db = clampLevellerGateDb(db);`.
- `setChannelName(id, name)` (`:90`): after `const resolved = name.trim() || ch.defaultName;`, wrap: `const clamped = clampNameToByteBudget(resolved, CHANNEL_NAME_MAX_LEN);` and use `clamped` in the `commitBulk` body for both `c.name` and `o.name`.

- [ ] **Step 3: Write a regression test for the boundary**

**Files:** Test: `src/runtime/actions.clamp.test.ts`

```ts
// src/runtime/actions.clamp.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setMasterVolume, setOutputDelay } from './actions';
import { dsp } from '@/state';
// Reuse whatever device/snapshot test harness the existing
// src/runtime/actions.test.ts uses to connect a MockTransport and sync a
// snapshot. Mirror its beforeEach setup here.

describe('action boundary clamps out-of-range values', () => {
  beforeEach(async () => {
    // TODO mirror actions.test.ts harness: create MockTransport device,
    // bind, syncDeviceSnapshot().
  });
  it('clamps master volume above 0 dB to 0', () => {
    setMasterVolume(12);
    expect(dsp.live?.masterVolumeDb).toBe(0);
  });
  it('clamps output delay above the UI cap to 170 ms', () => {
    setOutputDelay(0, 999);
    expect(dsp.live?.outputs.find((o) => o.wireIndex === 0)?.delayMs).toBe(170);
  });
});
```
> NOTE: the `beforeEach` harness is the only part to copy from `src/runtime/actions.test.ts` — read that file's setup block and reproduce it. Do not invent a new mock.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/runtime/actions.clamp.test.ts src/runtime/actions.test.ts`
Expected: PASS. Existing `actions.test.ts` must stay green (clamping in-range values is a no-op).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/actions.ts src/runtime/actions.clamp.test.ts
git commit -m "feat(runtime): clamp write values at the action boundary (ADR-004)"
```

### Task 3: Delete the dead validator

**Files:**
- Delete: `src/domain/validation.ts`, `src/domain/validation.test.ts`

- [ ] **Step 1: Confirm no production import**

Run: `grep -rn "domain/validation" src --include=*.ts --include=*.svelte | grep -v "validation.test"`
Expected: no output (it was already dead — board review D-1 / ADR-004 confirmed).

- [ ] **Step 2: Delete the files**

```bash
git rm src/domain/validation.ts src/domain/validation.test.ts
```

- [ ] **Step 3: Verify build + tests**

Run: `npm run check && npx vitest run`
Expected: 0 type errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(domain): delete dead validation.ts in favor of clamp choke point (ADR-004)"
```

---

## ADR-006 — One consistent action-verb contract

Three normalizations: (a) add `dismissPresetActionError()` and stop the UI writing store state; (b) all mutating preset verbs return a typed `Result`; (c) boolean device flags become `setX(enabled)` instead of `toggleX()`.

### Task 4: Add `dismissPresetActionError()` verb

**Files:**
- Modify: `src/runtime/presets.ts`
- Modify: `src/components/tabs/PresetsTab.svelte:59`
- Test: `src/runtime/presets.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/runtime/presets.test.ts`:
```ts
import { dismissPresetActionError } from './presets';
import { presets } from '@/state';

it('dismissPresetActionError clears the error banner state', () => {
  presets.lastActionError = 'Save: boom';
  dismissPresetActionError();
  expect(presets.lastActionError).toBe(null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/runtime/presets.test.ts -t "dismissPresetActionError"`
Expected: FAIL — `dismissPresetActionError is not exported`.

- [ ] **Step 3: Add the verb**

In `src/runtime/presets.ts`, export (reuse the existing private `clearActionError`):
```ts
// Public verb so the UI never writes preset store state directly
// (board review A5 / MOM-2026-05-22). The error banner dismiss button
// calls this instead of assigning presets.lastActionError = null.
export function dismissPresetActionError(): void {
  clearActionError();
}
```

- [ ] **Step 4: Update the UI call site**

In `src/components/tabs/PresetsTab.svelte`:
- Add `dismissPresetActionError` to the existing import from the runtime presets module.
- Line 59: replace
  ```svelte
  <button onclick={() => { presets.lastActionError = null; }} aria-label="Dismiss">×</button>
  ```
  with
  ```svelte
  <button onclick={() => dismissPresetActionError()} aria-label="Dismiss">×</button>
  ```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run check && npx vitest run src/runtime/presets.test.ts`
Expected: PASS, 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/presets.ts src/components/tabs/PresetsTab.svelte src/runtime/presets.test.ts
git commit -m "feat(presets): add dismissPresetActionError verb; stop UI writing store state (ADR-006)"
```

### Task 5: Normalize record-only preset verbs to typed `Result`

**Files:**
- Modify: `src/runtime/presets.ts`
- Test: `src/runtime/presets.test.ts`

Today `renamePresetSlot`, `setStartupDefault`, `setStartupMode`, `setPresetIncludePins` return `Promise<void>` and surface failure only via `presets.lastActionError`. Make them return the same `PresetActionError | Result<void, ...>` shape the load/save verbs use, while STILL recording the error (the banner keeps working).

- [ ] **Step 1: Write the failing test**

Add to `src/runtime/presets.test.ts` (mirror the existing wire-fail harness used around line 225):
```ts
it('renamePresetSlot returns a typed failure on wire error', async () => {
  // arrange: device.setPresetName rejects (reuse existing failing-device harness)
  const r = await renamePresetSlot(1 as PresetSlot, 'X');
  expect('ok' in r && r.ok).toBe(false);
});
it('renamePresetSlot returns ok on success', async () => {
  const r = await renamePresetSlot(1 as PresetSlot, 'X');
  expect('ok' in r && r.ok).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/runtime/presets.test.ts -t "renamePresetSlot returns"`
Expected: FAIL — current return type is `void`.

- [ ] **Step 3: Change the signatures**

For each of `renamePresetSlot`, `setStartupDefault`, `setStartupMode`, `setPresetIncludePins`: change the return type to `Promise<Result<void, PresetResult> | PresetActionError>` and:
- on the no-device early return, `return noDevice();`
- wrap the body in the existing `try/withBusy`; on success `return Result.ok();`
- in `catch`, keep `recordActionError(...)` then `return recordToResult(...)` (helper below).

Add a small helper near `recordActionError`:
```ts
import { Result } from '@/utils';
// (Result is already importable from '@/utils'; presets.ts currently imports
// only the type — switch to the value import.)

function recordToResult(label: string, e: unknown): PresetActionError {
  recordActionError(label, e);
  const msg = (e as Error)?.message ?? String(e);
  return { ok: false, code: 'no-device', message: `${label}: ${msg}` } as PresetActionError;
}
```
> NOTE: `presets.ts:15` currently imports `type Result` (type-only). Change to `import { Result, type Result as ... }` — or simply `import { Result } from '@/utils'` and use `Result.ok()`. Verify the existing `Result` value export in `@/utils` (it is used in `actions.ts:17`).

Example — `renamePresetSlot` becomes:
```ts
export async function renamePresetSlot(
  slot: PresetSlot, name: string,
): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = session.device;
  if (!d) return noDevice();
  clearActionError();
  try {
    return await withBusy(async () => {
      await d.setPresetName(slot, name);
      const next = [...presets.names];
      next[slot] = name;
      presets.names = next;
      return Result.ok();
    });
  } catch (e) {
    return recordToResult('Rename', e);
  }
}
```
Apply the same pattern to `setStartupDefault` ('Set startup default'), `setStartupMode` ('Set startup mode'), `setPresetIncludePins` ('Set include pins').

- [ ] **Step 4: Run tests**

Run: `npm run check && npx vitest run src/runtime/presets.test.ts`
Expected: PASS. Existing record-only tests (which assert `presets.lastActionError` contains the label) still pass because `recordActionError` still fires.

- [ ] **Step 5: Update any callers expecting void**

Run: `grep -rn "renamePresetSlot\|setStartupDefault\|setStartupMode\|setPresetIncludePins" src --include=*.svelte`
For each call site that `await`s without using the return, no change is needed (the new `Result` is simply ignored). If any site does `.then()`/destructures, adapt to the `Result` shape.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/presets.ts src/runtime/presets.test.ts
git commit -m "refactor(presets): normalize directory-mutating verbs to typed Result (ADR-006)"
```

### Task 6: Normalize boolean device flags to `setX(enabled)`

**Files:**
- Modify: `src/runtime/actions.ts`
- Modify: UI call sites (swept by grep)
- Test: `src/runtime/actions.test.ts`

Replace read-modify-write `toggle*` verbs with explicit `set*(enabled)` verbs so all boolean flags share one mental model. Affected: `toggleCrosspoint`, `toggleCrosspointInvert`, `toggleOutputEnable`, `toggleOutputMute`. (`toggleMute` for master is a UX affordance over soft-mute, not a device flag — leave it, but see note.)

- [ ] **Step 1: Write the failing test**

Add to `src/runtime/actions.test.ts`:
```ts
import { setOutputEnabled, setOutputMuted } from './actions';

it('setOutputEnabled(false) disables the output explicitly', () => {
  // harness: device synced, output 0 starts enabled
  setOutputEnabled(0, false);
  expect(dsp.live?.outputs.find((o) => o.wireIndex === 0)?.enabled).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/runtime/actions.test.ts -t "setOutputEnabled"`
Expected: FAIL — `setOutputEnabled` not exported.

- [ ] **Step 3: Convert the verbs**

In `src/runtime/actions.ts`, replace the four toggles. Crosspoint pair:
```ts
export function setCrosspointEnabled(input: InputSlot, output: OutputSlot, enabled: boolean): void {
  scheduleCrosspointWrite(input, output, (r) => ({ ...r, enabled }));
}
export function setCrosspointInvert(input: InputSlot, output: OutputSlot, invert: boolean): void {
  scheduleCrosspointWrite(input, output, (r) => ({ ...r, invert }));
}
```
Output pair (replace `:235` and `:242`):
```ts
export function setOutputEnabled(slot: OutputSlot, enabled: boolean): void {
  commitBulk((s) => {
    const o = s.outputs.find((o) => o.wireIndex === slot);
    if (o) o.enabled = enabled;
  });
}
export function setOutputMuted(slot: OutputSlot, muted: boolean): void {
  commitBulk((s) => {
    const o = s.outputs.find((o) => o.wireIndex === slot);
    if (o) o.muted = muted;
  });
}
```

- [ ] **Step 4: Sweep UI call sites**

Run: `grep -rn "toggleCrosspoint\|toggleCrosspointInvert\|toggleOutputEnable\|toggleOutputMute" src --include=*.svelte --include=*.ts | grep -v actions.ts`
For each hit, the component already knows the current value (it renders it). Replace the toggle call with the explicit setter passing the negated current value, e.g.:
- `toggleOutputEnable(slot)` → `setOutputEnabled(slot, !out.enabled)`
- `toggleOutputMute(slot)` → `setOutputMuted(slot, !out.muted)`
- `toggleCrosspoint(i, o)` → `setCrosspointEnabled(i, o, !route.enabled)`
- `toggleCrosspointInvert(i, o)` → `setCrosspointInvert(i, o, !route.invert)`
Update the corresponding imports in each component.

- [ ] **Step 5: Update existing tests referencing the toggles**

Run: `grep -rn "toggleCrosspoint\|toggleOutputEnable\|toggleOutputMute" src --include=*.test.ts`
Convert each to the explicit setter form.

- [ ] **Step 6: Run full check**

Run: `npm run check && npx vitest run && npm run lint`
Expected: 0 type errors, all tests pass, lint clean. **Manually verify in the browser** (`npm run dev`): toggle an output enable/mute and a matrix crosspoint, confirm the UI still flips state and the device receives the write.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/actions.ts src/components src/runtime/actions.test.ts
git commit -m "refactor(runtime): normalize boolean device flags to setX(enabled) (ADR-006)"
```

### Task 7: Update ARCH.md + close Phase 1

**Files:**
- Modify: `docs/ARCH.md` (validation line 66, verb-contract notes)

- [ ] **Step 1: Update the validation note**

`docs/ARCH.md:66` currently reads "UI controls clamp values before calling runtime actions. The command layer does not validate every value again." Replace with a note that the action boundary now clamps via `src/domain/clamp.ts` as the single host-side gate; UI panels keep affordances only.

- [ ] **Step 2: Run the full Phase-1 gate**

Run: `npm run check && npm test && npm run lint`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add docs/ARCH.md
git commit -m "docs(arch): record clamp choke point + uniform verb contract (ADR-004/006)"
```

---

# PHASES 2–5 — roadmap-level scope (detailed plans authored at phase start)

## Phase 2 — ADR-003: device speaks snapshots

**Outcome:** `BulkParams` is no longer a runtime concept. `DspDevice` exposes `getSnapshot(): DspSnapshot`, `applyBulk(draft): Promise<void>`, and (later) `applyWrite(intent)`. `fromBulkParams`/`toBulkParams`, enum narrowing (`narrowFilterType`, `narrowCrossfeedPreset`, `narrowLevellerSpeed`, `narrowPlatform`), and the hardcoded `formatVersion: 6` move out of `src/domain/bulkToSnapshot.ts` and behind the adapter. `wireBase` becomes an opaque handle the runtime never inspects.

**Key tasks (to be expanded into TDD steps at phase start):**
- Add `getSnapshot`/`applyBulk` to `DspDevice`, internalizing `hardware` + mapping; keep `getAllParams`/`setAllParams` as private/internal wire ops.
- Move `narrow*` and the snapshot⇄bulk mapping into the device layer; strip wire knowledge from `domain/`.
- Update `src/runtime/commit.ts`, `resync.ts`, `presets.ts` paste path to deal in snapshots, not packets.
- Adapter privately holds the last-accepted packet (sets up ADR-002's `wireBase` relocation).

**Risk/sequencing note:** Board review A3 says do this *after* invariant encapsulation. We satisfy that by pairing it tightly with Phase 3 — land the adapter seam first, then immediately shrink the store. Keep `master` green between the two by having the store still expose `wireBase` as an opaque handle until Phase 3.

## Phase 3 — ADR-002: shrink store to `draft` + `saved`

**Outcome:** `src/state/dsp.svelte.ts` holds two cells — `draft` (optimistic, was `live`) and `saved` (dirty baseline, was `shadow`). `wireBase` is gone from the store (lives in the adapter from Phase 2). Cells become module-private; the store exports a readonly-typed view plus verbs. The "advance shadow / refresh wireBase" honor-system invariant (ARCH.md:65) is deleted because the coupling no longer exists. `presetDiff` compares `draft` vs `saved` only.

**Key tasks:**
- Rename `live`→`draft`, `shadow`→`saved` (mechanical, wide); update all readers.
- Remove `wireBase` cell + `applyBulkLive`/`fromBulkParams` usage from the store.
- Stop exporting bare `applyBulkBaseline` from the state barrel (board review A4); all baseline application goes through the converged runtime verb.
- Make cells private behind a readonly view; no external module can assign them.
- Check the channel-name false-dirty hypothesis (board review D-6): with Phase-1 `clampNameToByteBudget` already truncating on write, confirm the false-dirty case is closed; add a regression test.

## Phase 4 — ADR-001: single outbox + control policy (HIGH RISK)

**Outcome:** `src/runtime/commands.ts`, `commit.ts`, `outbox.ts`, `focus.ts` are replaced by one `src/runtime/outbox.ts` and a `src/runtime/controlPolicy.ts` table. Each control declares `{ strategy: 'granular' | 'bulk', coalesceKey?, debounceMs?, converge: 'resync' | 'self' }`. The outbox exposes `enqueue(intent)`, `flush()`, `cancel(generation)`.

**Load-bearing requirements (must be preserved — verified against source):**
- **Two convergence behaviors:** granular intents schedule a trailing resync (`commands.ts` `runGuarded`→`scheduleResync`); bulk intents self-converge by setting the adapter's last packet and skipping resync (`commit.ts:76-77`). The policy's `converge` field encodes this.
- **Coalescing:** per-key 16 ms for granular (`SCRUB_MS`); per-key 16 ms trailing for debounced bulk sliders.
- **Cancellation/stale-guards:** the generation counter is sufficient as the primary stale guard; collapse the heavier `currentRev`/`lastSentRev`/`BULK_TOKEN`/run-identity quartet to `pending: boolean` + one `inflight` promise (board review A4/D-5), but **preserve the detached-send teardown** that the run-identity check in `commit.ts:84` currently guards.
- **`flushPending()` drain order** before preset flash must be reproduced exactly: drain trailing timers + converge bulk → drain granular lanes → await in-flight → converge again if edits landed mid-drain.

**Key tasks:** build `controlPolicy` table from the current verb-to-lane mapping (granular: master volume/preamp, input preamp, matrix route, output gain; bulk: everything else); build the unified outbox preserving both converge paths; migrate `actions.ts` verbs to `enqueue`; delete the four old modules; port their tests to the outbox.

**Migration approach:** write the new outbox alongside the old lanes, migrate verbs one group at a time with tests green at each step, delete old modules last. The full test suite (incl. HIL) is the cutover gate.

## Phase 5 — ADR-005: split granular facade + delete dead methods

**Outcome:** `DspDevice`'s public surface to the app is exactly the runtime-facing set; the full granular CRUD lives behind a separate `DspDeviceGranular` facade used only by HIL/unit tests.

**HIL dependency map (verified):**
- **Runtime-facing (keep on `DspDevice`):** `getAllParams`/`setAllParams` (or the Phase-2 `getSnapshot`/`applyBulk`), `info`, `hardware`, `create`; `getSystemStatus`/`getSystemInfo`/`getBufferStats`; `setMasterVolume`/`setMasterPreamp`/`setInputPreamp`/`setMasterVolumeMode`/`saveMasterVolume`; `setMatrixRoute`/`setOutputGain`; `clearClips`/`factoryReset`; preset verbs `getPresetDirectory`/`getActivePreset`/`getPresetName`/`savePreset`/`loadPreset`/`deletePreset`/`setPresetName`/`setPresetStartup`/`setPresetIncludePins`.
- **HIL/test-only (move to `DspDeviceGranular`):** `getFilter`/`setFilter`, `getBypass`/`setBypass`, `getMasterPreamp`/`getInputPreamp`/`getMasterVolume`/`getMasterVolumeMode`/`getSavedMasterVolume`, `getMatrixRoute`, `getOutputEnable`/`getOutputMute`/`getOutputDelay`/`setOutputEnable`/`setOutputMute`/`setOutputDelay`, `getChannelName`/`setChannelName`, `setLoudnessEnabled`/`setLoudnessRefSpl`/`setLoudnessIntensity`, `setCrossfeedPreset`, `setLevellerSpeed`/`setLevellerAmount`, `getPresetStartup`/`getPresetIncludePins`, `saveParams`/`loadParams`, `resetBufferStats`.
- **Delete outright (dead even to tests):** `setCrossfeedEnabled`, `setCrossfeedItd`, `setCrossfeedFreq`, `setCrossfeedFeedDb`, `setLevellerEnabled`, `setLevellerLookahead`, `setLevellerMaxGain`, `setLevellerGate`, `close`. (Confirm once more with a grep at phase start before deleting.)

**Key tasks:** extract the HIL-only methods into `DspDeviceGranular` wrapping the same transport; point `mixer.hil.test.ts`/`presets.hil.test.ts`/`actions.test.ts`/`DspDevice.test.ts` at the facade; delete the dead setters; run `npm run test:hil` as the gate.

---

## Self-review notes

- **Spec coverage:** every ADR (001–006) maps to a phase; every board-review action (A1→P5, A2→P1, A3→P2, A4→P3/P4, A5→P1, A6 backlog items not in scope) is placed.
- **Open questions:** all three from the ADR are resolved in the header section.
- **Type consistency:** new verb names are fixed here — `setOutputEnabled`/`setOutputMuted`/`setCrosspointEnabled`/`setCrosspointInvert` (Phase 1), `getSnapshot`/`applyBulk`/`applyWrite` (Phase 2), `draft`/`saved` (Phase 3), `controlPolicy` `{strategy, coalesceKey, debounceMs, converge}` (Phase 4). Use these names verbatim downstream.
- **Phases 2–5 are intentionally roadmap-level** — they get full TDD plans authored at the start of each phase, against the actual code their predecessors leave behind.
