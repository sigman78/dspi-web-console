# Phase 2 — ADR-003: Device Speaks Snapshots (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `DspDevice` the sole owner of the wire DTO (`BulkParams`). Its app-facing surface becomes snapshot-in / snapshot-out: `getSnapshot()`, `applyBulk(draft)`, plus an opaque `captureState()`/`restoreState()` for the preset-paste blob copy. The snapshot⇄wire mapping, enum narrowing, and the hardcoded `formatVersion: 6` move out of `src/domain` into the device layer. `wireBase` leaves the store entirely (the device holds the last-accepted packet privately).

**Architecture:** Ports-and-adapters. After this phase, `src/runtime/**` and `src/domain/**` never reference `BulkParams`. The store keeps `live` + `shadow` only (the `live`→`draft` / `shadow`→`saved` rename and cell encapsulation are deferred to Phase 3 / ADR-002).

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest, V6 wire protocol.

**Source:** `ADN-2026-05-22.md` ADR-003 (and board review A3). Builds on Phase 1 (committed).

---

## Key design decisions (made during planning — flag if any is wrong)

1. **Device API names** follow the ADR: `getSnapshot(): Promise<DspSnapshot>` and `applyBulk(draft: DspSnapshot): Promise<void>`. (`applyWrite(intent)` is Phase 4 / ADR-001 — NOT in this phase.)
2. **`wireBase` is removed from the store in this phase**, not kept as an opaque handle. Once the device owns the last-accepted packet, a store-side handle is dead weight. The state-layer appliers change from `(hardware, bulk: BulkParams)` to `(snapshot: DspSnapshot)`. This absorbs ADR-002's `wireBase` removal; Phase 3 then only does the `live`→`draft`/`shadow`→`saved` rename + cell encapsulation.
3. **Preset paste** uses a new opaque `captureState(): Promise<DeviceState>` / `restoreState(s: DeviceState): Promise<void>` pair. `DeviceState` is an opaque/branded type exported by the device layer; internally it is `BulkParams`, but runtime never inspects it. `getAllParams`/`setAllParams` remain on `DspDevice` as device-internal wire I/O (HIL tests still use them; ADR-005 relocates granular methods later).
4. **The connect-race guard** (`commitBulk` no-ops before the first packet — board review D-7) is preserved via a new `get hasState(): boolean` on the device, replacing the `!dsp.wireBase` check.
5. **The mapping moves to `src/device/snapshotCodec.ts`** (new file), not inlined into `DspDevice.ts` (keeps the device class focused). `narrowFilterType/Platform/CrossfeedPreset/LevellerSpeed`, `fromBulkParams`, `toBulkParams`, and `formatVersion: 6` all move there. `src/domain/index.ts` stops exporting `bulkToSnapshot`.

---

## File structure

- Move: `src/domain/bulkToSnapshot.ts` → `src/device/snapshotCodec.ts` (+ its test → `src/device/snapshotCodec.test.ts`).
- Modify: `src/domain/index.ts` — drop `export * from './bulkToSnapshot'`.
- Modify: `src/device/DspDevice.ts` — add `#wireBase`, `getSnapshot`, `applyBulk`, `hasState`, `captureState`, `restoreState`; import the codec.
- Modify: `src/state/dsp.svelte.ts` — remove `wireBase`; appliers take `DspSnapshot`.
- Modify: `src/runtime/commit.ts` — use `d.applyBulk(dsp.live)` + `d.hasState`; `applyBulkBaselineConverged` takes a snapshot.
- Modify: `src/runtime/resync.ts` — `d.getSnapshot()` instead of `getAllParams()` + state mapping.
- Modify: `src/runtime/actions.ts` — `syncDeviceSnapshot` uses `d.getSnapshot()`.
- Modify: `src/runtime/presets.ts` — paste uses `captureState`/`restoreState`.
- Modify: tests across `state/`, `runtime/`, and add device tests.

---

## Task 2.1 — Move the snapshot⇄wire codec into the device layer (behavior-preserving)

Pure relocation. No logic change. Establishes that the mapping lives in the device layer and domain has no wire knowledge.

**Files:**
- Move: `src/domain/bulkToSnapshot.ts` → `src/device/snapshotCodec.ts`
- Move: `src/domain/bulkToSnapshot.test.ts` → `src/device/snapshotCodec.test.ts`
- Modify: `src/domain/index.ts`, and every importer of `fromBulkParams`/`toBulkParams`.

- [ ] **Step 1: Inventory importers.** Run:
  `rg -n "bulkToSnapshot|fromBulkParams|toBulkParams" src`
  Expected importers of the functions today: `src/state/dsp.svelte.ts` (`fromBulkParams` via `@/domain`), `src/runtime/commit.ts` (`toBulkParams` via `@/domain`), and the test file. Note each.

- [ ] **Step 2: Move the files with git.**
  ```bash
  git mv src/domain/bulkToSnapshot.ts src/device/snapshotCodec.ts
  git mv src/domain/bulkToSnapshot.test.ts src/device/snapshotCodec.test.ts
  ```

- [ ] **Step 3: Fix the moved files' relative imports.** `snapshotCodec.ts` previously imported from `./channels`, `./hardware`, `./filter`, `./platform`, `./processing`, `./snapshot`, `./mixer` (all `src/domain/*`). From `src/device/` these become `@/domain` imports. Replace the block:
  ```ts
  import { Wire, type BulkParams, type WireFilter } from '@/protocol';
  import {
    outputModeForChannel, type InputSlot,
    displayNameForHardwareChannel, wireChannelFor, type HardwareProfile,
    FilterType, type FilterParams,
    PlatformType, CrossfeedPreset, LevellerSpeed,
    type DspSnapshot,
    type CrossPoint, type OutputModel, type OutputState, type RouteModel,
  } from '@/domain';
  ```
  Verify each symbol is exported from `@/domain` (they are: channels, hardware, filter, platform, processing, snapshot, mixer are all barrel-exported). Update the test file's import of the functions from `./bulkToSnapshot` → `./snapshotCodec` (same directory).

- [ ] **Step 4: Remove the domain barrel export.** In `src/domain/index.ts` delete the line `export * from './bulkToSnapshot';`.

- [ ] **Step 5: Update the two production importers to import the codec from the device layer.**
  - `src/state/dsp.svelte.ts`: change `import { fromBulkParams, ... } from '@/domain'` so `fromBulkParams` comes from `@/device/snapshotCodec` (keep the type imports `DspSnapshot`, `HardwareProfile` from `@/domain`). NOTE: this is temporary — Task 2.3 removes this import entirely. Do the minimal correct import now so the build is green.
  - `src/runtime/commit.ts`: change `import { toBulkParams } from '@/domain'` → `import { toBulkParams } from '@/device/snapshotCodec'`. (Also temporary; removed in 2.3.)

- [ ] **Step 6: Verify — behavior-preserving move.**
  `npm run check` → 0 errors. `npx vitest run` → full suite passes (same count as Phase 1 end: 415). `npm run lint` → no new errors.

- [ ] **Step 7: Commit.**
  ```bash
  git add -A
  git commit -m "refactor(device): move snapshot<->wire codec into device layer (ADR-003)"
  ```

---

## Task 2.2 — Add the snapshot-facing device API (additive; runtime unchanged)

Add the new methods to `DspDevice` alongside the existing `getAllParams`/`setAllParams`. Runtime does not use them yet — this task is additive and independently testable.

**Files:**
- Modify: `src/device/DspDevice.ts`
- Modify: `src/device/snapshotCodec.ts` (export an opaque `DeviceState` type)
- Test: `src/device/DspDevice.snapshot.test.ts` (new)

- [ ] **Step 1: Export an opaque DeviceState handle.** In `src/device/snapshotCodec.ts`, add:
  ```ts
  // Opaque handle for the preset-paste device-to-device copy. Runtime holds
  // it between captureState/restoreState but must never inspect it. Internally
  // a BulkParams packet; the brand keeps wire shape out of the runtime types.
  export type DeviceState = BulkParams & { readonly __brand: 'DeviceState' };
  ```
  (A structural brand on the existing type — no runtime cost; just prevents runtime code from treating it as a plain `BulkParams`.)

- [ ] **Step 2: Write failing device tests** at `src/device/DspDevice.snapshot.test.ts`. Read `src/device/DspDevice.test.ts` first to copy its MockTransport-backed device construction (`DspDevice.create(...)` / the existing harness). Then:
  ```ts
  import { describe, it, expect, beforeEach } from 'vitest';
  // + device construction harness copied from DspDevice.test.ts

  describe('DspDevice snapshot API', () => {
    // beforeEach: build a MockTransport-backed device `d`
    it('hasState is false before any snapshot fetch', () => {
      expect(d.hasState).toBe(false);
    });
    it('getSnapshot returns a domain snapshot and sets hasState', async () => {
      const snap = await d.getSnapshot();
      expect(snap.formatVersion).toBeGreaterThanOrEqual(3);
      expect(Array.isArray(snap.channels)).toBe(true);
      expect(d.hasState).toBe(true);
    });
    it('applyBulk throws if called before any snapshot fetch', async () => {
      await expect(d.applyBulk({} as any)).rejects.toThrow();
    });
    it('applyBulk round-trips an edited snapshot through the wire', async () => {
      const snap = await d.getSnapshot();
      snap.masterVolumeDb = -12;
      await d.applyBulk(snap);
      const after = await d.getSnapshot();
      expect(after.masterVolumeDb).toBe(-12);
    });
    it('captureState + restoreState copy device state opaquely', async () => {
      await d.getSnapshot();
      const blob = await d.captureState();
      // mutate device via applyBulk, then restore the blob
      const snap = await d.getSnapshot();
      snap.masterVolumeDb = -30;
      await d.applyBulk(snap);
      await d.restoreState(blob);
      const restored = await d.getSnapshot();
      expect(restored.masterVolumeDb).toBe(blob.masterVolumeDb);
    });
  });
  ```
  Run → FAIL (methods undefined).

- [ ] **Step 3: Implement the methods in `DspDevice.ts`.** Add the import and private field, and the methods near `getAllParams`/`setAllParams`:
  ```ts
  import { fromBulkParams, toBulkParams, type DeviceState } from './snapshotCodec';
  import type { DspSnapshot } from '@/domain';
  // ... inside the class:
  #wireBase: BulkParams | null = null;

  // True once the device has fetched at least one packet — guards optimistic
  // bulk writes during the connect race (a write before the first snapshot has
  // no base to overlay).
  get hasState(): boolean {
    return this.#wireBase !== null;
  }

  // Snapshot-out: fetch the wire packet, retain it as the overlay base, and
  // return the domain view. The sole app-facing read path.
  async getSnapshot(): Promise<DspSnapshot> {
    const bulk = await this.getAllParams();
    this.#wireBase = bulk;
    return fromBulkParams(this.hardware, bulk);
  }

  // Snapshot-in: overlay the draft onto the retained base packet and push it.
  // Updates the base to the packet just sent so the next overlay is correct.
  async applyBulk(draft: DspSnapshot): Promise<void> {
    if (!this.#wireBase) throw new Error('applyBulk before getSnapshot: no wire base');
    const bulk = toBulkParams(this.hardware, draft, this.#wireBase);
    await this.setAllParams(bulk);
    this.#wireBase = bulk;
  }

  // Opaque capture/restore for the preset-paste device-to-device copy.
  async captureState(): Promise<DeviceState> {
    return (await this.getAllParams()) as DeviceState;
  }
  async restoreState(state: DeviceState): Promise<void> {
    await this.setAllParams(state);
    this.#wireBase = state;
  }
  ```

- [ ] **Step 4: Run device tests** → PASS. `npm run check` → 0 errors.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/device/DspDevice.ts src/device/snapshotCodec.ts src/device/DspDevice.snapshot.test.ts
  git commit -m "feat(device): add snapshot-facing API (getSnapshot/applyBulk/captureState) (ADR-003)"
  ```

---

## Task 2.3 — Rewire runtime + store to the snapshot API; remove `wireBase` (integration; the load-bearing task)

This is the critical task. The store stops holding `wireBase`; the appliers take snapshots; the runtime write/read/paste paths use the new device API. **Convergence semantics must be preserved exactly** (see the invariants below).

**Invariants that MUST hold after this task (verify against `src/runtime/commit.ts` + tests):**
- Bulk send still self-converges: after a successful `applyBulk`, the device's `#wireBase` is the just-sent packet (handled inside `applyBulk`); the store no longer mirrors it.
- The generation guard still silences stale settles (no `setStatus('error')`/no re-flush after disconnect).
- The detached-send run-identity teardown in the `finally` block is unchanged.
- The connect-race guard is preserved: `commitBulk` does not attempt a send until `d.hasState` is true.
- Trailing resync still refreshes `live` (live-only) without touching `shadow`.
- Preset load/paste/revert still move `live` + `shadow` together via the baseline applier.

**Files:** `src/state/dsp.svelte.ts`, `src/runtime/commit.ts`, `src/runtime/resync.ts`, `src/runtime/actions.ts`, `src/runtime/presets.ts`, plus their tests.

- [ ] **Step 1: Update the store appliers to take snapshots and drop `wireBase`.** In `src/state/dsp.svelte.ts`:
  - Delete the `wireBase` field from the `DspState` interface and the `DspStateImpl` class (and the `$state.raw` cell + its comment), plus the `BulkParams`/`fromBulkParams` imports.
  - Update the matrix comment block to two cells (`live`, `shadow`) — remove the wireBase column and the "not expressible" paragraph (that invariant is gone).
  - Change the appliers:
    ```ts
    // Full baseline: live + shadow from one snapshot.
    function applyBaseline(snapshot: DspSnapshot): void {
      dsp.live = snapshot;
      dsp.shadow = structuredClone(snapshot);
    }
    // Device already owns the wire packet; callers pass a snapshot from getSnapshot().
    export function applyBaselineSnapshot(snapshot: DspSnapshot): void {
      applyBaseline(snapshot);
    }
    // Live-only refresh: advance live, leave shadow pinned.
    export function applyLiveSnapshot(snapshot: DspSnapshot): void {
      dsp.live = snapshot;
    }
    ```
    Remove `applyBulkBaseline` and `applyBulkLive` (the `(hardware, bulk)` versions). `resetDsp` drops the `dsp.wireBase = null` line. `patchSnapshot`/`refreshShadowFromLive` are unchanged.
  - Update the state barrel `src/state/index.ts` (find it) to export `applyBaselineSnapshot`/`applyLiveSnapshot` and stop exporting `applyBulkBaseline`/`applyBulkLive`.

- [ ] **Step 2: Update `commit.ts`.**
  - `applyBulkBaselineConverged(hardware, bulk)` → `applyBaselineConverged(snapshot: DspSnapshot)`: calls `applyBaselineSnapshot(snapshot)` then resets revs. Drop the `HardwareProfile`/`BulkParams` imports and `toBulkParams` import.
  - In `flushBulkIfIdle`: replace the guard `if (flush.inflight || !dsp.live || !dsp.wireBase) return;` with `if (flush.inflight || !dsp.live) return; const d = session.device; if (!d || !d.hasState) return;`. Replace the body
    ```ts
    const bulk = toBulkParams(d.hardware, dsp.live, dsp.wireBase);
    // ...
    await d.setAllParams(bulk);
    if (gen !== session.generation) return;
    dsp.wireBase = bulk;
    flush.lastSentRev = sendingRev;
    ```
    with
    ```ts
    const draft = dsp.live;
    // ...
    await d.applyBulk(draft);              // device overlays + retains the packet
    if (gen !== session.generation) return; // stale settle: silent no-op
    flush.lastSentRev = sendingRev;
    ```
    (Keep `sendingRev`/`gen` capture, the run-identity `finally` teardown, the catch→forceResyncNow, and `syncBulkToken` exactly as-is.)

- [ ] **Step 3: Update `resync.ts`.**
  - `fetchAndApply`: `const snap = await d.getSnapshot(); ...; applyLiveSnapshot(snap);` (replace `getAllParams()` + `applyBulkLive(d.hardware, bulk)`; keep both `pendingWrites` soft-skip checks around the await).
  - `fetchAndApplyAsBaseline`: `const snap = await d.getSnapshot(); applyBaselineConverged(snap);` (replace `getAllParams()` + `applyBulkBaselineConverged`). Update imports (`applyLiveSnapshot` from state; `applyBaselineConverged` from `./commit`).

- [ ] **Step 4: Update `actions.ts`.** `syncDeviceSnapshot`: replace
  ```ts
  const bulk = await d.getAllParams();
  applyBulkBaselineConverged(d.hardware, bulk);
  ```
  with
  ```ts
  const snap = await d.getSnapshot();
  applyBaselineConverged(snap);
  ```
  Update the import of `applyBulkBaselineConverged` → `applyBaselineConverged`.

- [ ] **Step 5: Update `presets.ts` paste.** In `pastePresetTo`, replace the blob round-trip:
  ```ts
  const sourceBlob = await d.getAllParams();   // -> const sourceBlob = await d.captureState();
  // ...
  await d.setAllParams(sourceBlob);            // -> await d.restoreState(sourceBlob);
  ```
  `sourceBlob` is now typed `DeviceState` (opaque) — runtime never inspects it. Remove any `BulkParams` import in `presets.ts` if present.

- [ ] **Step 6: Update tests.** This touches several test files that previously constructed `BulkParams` or asserted `dsp.wireBase`:
  - `src/state/dsp.svelte.test.ts`, `src/state/dsp.test.ts`: drop `wireBase` assertions; update calls to the new applier names (pass a `DspSnapshot` built via the codec or a fixture, not a `BulkParams`). Read each test and adapt to the snapshot-based appliers.
  - `src/runtime/commit.test.ts`: the "detached stale send" and convergence tests — update mocks so the device exposes `hasState`/`applyBulk` (or use a real MockTransport-backed `DspDevice`). Preserve the intent of every test (stale settle no-op, re-flush on newer edits, run-identity teardown). This is the highest-risk test migration — do not weaken assertions; adapt them to assert via the device's resulting state or call spies on `applyBulk`.
  - `src/runtime/commands.test.ts`, `src/runtime/poll.test.ts`, `src/runtime/actions.test.ts`, `src/runtime/presets.test.ts`: update any `getAllParams`/`setAllParams`/`wireBase` usage to the new API where they exercise the changed paths. Where a test still legitimately drives the device's wire I/O directly (HIL-style), `getAllParams`/`setAllParams` still exist — leave those.
  - Run the FULL suite after each file's migration to localize breakage.

- [ ] **Step 7: Full gate.** `npm run check` → 0 errors. `npx vitest run` → all pass. `npm run lint` → no new errors. `rg -n "wireBase|BulkParams" src/runtime src/domain` → ZERO matches (the whole point: runtime + domain are free of wire DTO).

- [ ] **Step 8: Commit.**
  ```bash
  git add -A
  git commit -m "refactor(runtime): device speaks snapshots; remove wireBase from store (ADR-003)"
  ```

---

## Task 2.4 — Tidy + docs

- [ ] **Step 1: Confirm domain is wire-free.** `rg -n "BulkParams|WireFilter|formatVersion: 6" src/domain` → only comments may remain (snapshot.ts/mixer.ts mention BulkParams in prose). No type usage, no `toBulkParams`/`fromBulkParams`. Fix any stragglers.
- [ ] **Step 2: Update `docs/ARCH.md` State Model + Key Files.** Note: ARCH.md is currently an uncommitted working-tree rewrite — add Phase-2 edits but do NOT commit ARCH.md (the user owns that file's commit). Update the State Model section to two cells + "the device adapter owns the last-accepted wire packet"; update the Key Files row `Snapshot/bulk mapping | src/device/snapshotCodec.ts`. Leave it staged-out / uncommitted, flag to the user.
- [ ] **Step 3: Final gate** `npm run check && npx vitest run && npm run lint` — all green.
- [ ] **Step 4:** No commit needed if only ARCH.md changed (left uncommitted). If any source tidy happened in Step 1, commit it:
  ```bash
  git add src/domain
  git commit -m "refactor(domain): confirm domain free of wire DTO (ADR-003)"
  ```

---

## Self-review notes
- **Coverage:** ADR-003's three moves are covered — mapping behind device (2.1+2.2), snapshot-in/out API (2.2), runtime/domain free of `BulkParams` + `wireBase` gone (2.3, verified by grep in 2.3 Step 7 / 2.4 Step 1).
- **Convergence risk** is concentrated in Task 2.3 Step 2/6 — the invariant list and the "don't weaken commit.test.ts" instruction guard it.
- **Type names fixed here:** `getSnapshot`, `applyBulk`, `hasState`, `captureState`/`restoreState`, `DeviceState`, `applyBaselineSnapshot`, `applyLiveSnapshot`, `applyBaselineConverged`. Use verbatim downstream (Phase 3 renames `live`→`draft`/`shadow`→`saved`).
- **Out of scope:** `applyWrite(intent)`, control policy, store cell rename/encapsulation (Phases 3–4).
