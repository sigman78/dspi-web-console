# Phase 4 — ADR-001: Single outbox + control-policy table (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. **This is the highest-risk phase of the refactor — preserve every invariant listed below.**

**Goal:** Collapse the two write lanes (`commands.ts` scrub + `commit.ts` bulk) and their cross-lane coordinator (`outbox.ts`) into ONE `outbox.ts` module fronted by a single `enqueue(intent)` plus `flush()` / `cancel()`, with a declarative `controlPolicy` table deciding granular-vs-bulk and convergence. Granular-vs-bulk becomes **data**, not three separate public verbs.

**What stays:** `focus.ts` (snapshot-addressing helpers `focusRoute`/`focusOutput` — used to build optimistic patches; not lane-coordination machinery, so collapsing it would not remove a coordination concept). The trailing-resync scheduler (`resync.ts`) and `DspDevice.applyBulk`/granular setters are unchanged.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest.

**Source:** `ADN-2026-05-22.md` ADR-001 + board review A5/U-1/D-5. Builds on Phases 1–3 (committed).

---

## INVARIANTS — must hold after the cutover (verified against current source)

The unified outbox MUST reproduce ALL of these. Each maps to an existing behavior + its test.

**Granular path (was `commands.ts`):**
- G1. **Per-key coalescing**, 16 ms (`SCRUB_MS`), latest-wins. Each `coalesceKey` is an independent lane; sends serialize *within* a key via an `inFlight` promise chain.
- G2. **Generation captured at fire time** (inside the timer callback, before the inFlight chain) — NOT at enqueue time, NOT after awaiting the chain.
- G3. On send success, if `gen === session.generation`: **schedule a trailing resync** (`scheduleResync()`). On failure (gen still matches): `setStatus('error')` + `forceResyncNow()`. Stale settles (gen changed): silent.
- G4. **pendingWrites token**: one token per active burst on a key (claimed on first `schedule` of the burst, dropped in `runGuarded`'s finally). `cancel()` drops the burst token.

**Bulk path (was `commit.ts`):**
- B1. `currentRev`/`lastSentRev` counters. `commitBulk`-equivalent mutates `dsp.draft`, bumps `currentRev`, flushes if idle.
- B2. **Self-converging**: send is `d.applyBulk(draft)`; on success (gen matches) `lastSentRev = sendingRev`. NO trailing resync. Guarded by `d.hasState` (connect race).
- B3. **Run-identity teardown**: only the send still owning `flush.inflight` clears the slot in `finally`; a detached send (after `cancel`) must not null a newer send's slot or re-flush. This is NOT generation-gated.
- B4. **Re-flush** in `finally` only while `session.status === 'connected'` and `currentRev > lastSentRev`.
- B5. **Debounced variant**: per-key 16 ms trailing timer defers the flush (was `commitBulkDebounced`).
- B6. **BULK_TOKEN**: a single computed-predicate token (`currentRev > lastSentRev || inflight !== null`) mirrored into `pendingWrites` via `syncBulkToken()`.
- B7. On bulk send failure (gen matches): `setStatus('error')` + `forceResyncNow()`.

**Cross-lane (was `outbox.ts`):**
- X1. `flush()` (was `flushPending`) order EXACTLY: drain trailing timers + converge → drain granular lanes → await bulk in-flight → converge → await bulk in-flight.
- X2. `cancel()` (was `cancelAllCommands`) EXACTLY: cancel granular lanes → `session.generation += 1` → `dsp.pendingWrites.clear()` → reset bulk flush state.
- X3. `applyBaselineConverged(snapshot)` applies the baseline AND zeroes `currentRev`/`lastSentRev` (connect / factory reset / preset transitions).
- X4. `convergeBulk()` fires one bulk send iff `currentRev > lastSentRev` (used by preset flush + trailing-timer drain).

**The full Vitest suite (currently 421) + the ported lane tests are the cutover gate.**

---

## Target API (the single front door)

```ts
// src/runtime/controlPolicy.ts
export type WriteStrategy = 'granular' | 'bulk';
export type Convergence = 'resync' | 'self';
export interface ControlPolicy {
  strategy: WriteStrategy;
  converge: Convergence;       // granular => 'resync'; bulk => 'self'
  debounceMs?: number;         // bulk only: debounced trailing flush (16)
}
// Keyed by control NAME (the static prefix of the coalesce key).
export const CONTROL_POLICY = {
  masterVolume: { strategy: 'granular', converge: 'resync' },
  masterPreamp: { strategy: 'granular', converge: 'resync' },
  inputPreamp:  { strategy: 'granular', converge: 'resync' },
  crosspoint:   { strategy: 'granular', converge: 'resync' },
  outputGain:   { strategy: 'granular', converge: 'resync' },

  // bulk immediate
  eqFilter: { strategy: 'bulk', converge: 'self' },
  bypass:   { strategy: 'bulk', converge: 'self' },
  channelName: { strategy: 'bulk', converge: 'self' },
  loudnessEnabled: { strategy: 'bulk', converge: 'self' },
  crossfeedEnabled: { strategy: 'bulk', converge: 'self' },
  crossfeedPreset:  { strategy: 'bulk', converge: 'self' },
  crossfeedItd:     { strategy: 'bulk', converge: 'self' },
  levellerEnabled:  { strategy: 'bulk', converge: 'self' },
  levellerSpeed:    { strategy: 'bulk', converge: 'self' },
  levellerLookahead:{ strategy: 'bulk', converge: 'self' },
  outputDelay:   { strategy: 'bulk', converge: 'self' },
  outputEnabled: { strategy: 'bulk', converge: 'self' },
  outputMuted:   { strategy: 'bulk', converge: 'self' },

  // bulk debounced (16 ms trailing)
  loudnessRefSpl:      { strategy: 'bulk', converge: 'self', debounceMs: 16 },
  loudnessIntensity:   { strategy: 'bulk', converge: 'self', debounceMs: 16 },
  crossfeedFreq:       { strategy: 'bulk', converge: 'self', debounceMs: 16 },
  crossfeedFeedDb:     { strategy: 'bulk', converge: 'self', debounceMs: 16 },
  levellerAmount:      { strategy: 'bulk', converge: 'self', debounceMs: 16 },
  levellerMaxGain:     { strategy: 'bulk', converge: 'self', debounceMs: 16 },
  levellerGate:        { strategy: 'bulk', converge: 'self', debounceMs: 16 },
} as const satisfies Record<string, ControlPolicy>;
export type ControlName = keyof typeof CONTROL_POLICY;
```

```ts
// src/runtime/outbox.ts — single enqueue front door
interface GranularIntent {
  control: ControlName;          // policy says strategy: 'granular'
  coalesceKey: string;           // instance key, e.g. `outputGain:${slot}`
  apply: () => void;             // optimistic patch (uses focus.ts/patchSnapshot)
  send: (d: DspDevice) => Promise<void>;
}
interface BulkIntent {
  control: ControlName;          // policy says strategy: 'bulk'
  debounceKey?: string;          // present when policy.debounceMs set
  mutate: (s: DspSnapshot) => void;
}
export function enqueue(intent: GranularIntent | BulkIntent): void;
export function flush(): Promise<void>;          // was flushPending
export function cancel(): void;                   // was cancelAllCommands
export function applyBaselineConverged(s: DspSnapshot): void;  // X3
```
The outbox reads `CONTROL_POLICY[intent.control]` and routes: granular → per-key scrub lane (G1–G4); bulk → rev-counter lane (B1–B7), debounced if `policy.debounceMs`. Convergence is taken from the policy (`'resync'` schedules a trailing resync after the granular send; `'self'` does not).

---

## Task 4.1 — `controlPolicy.ts` (pure data, standalone)

**Files:** Create `src/runtime/controlPolicy.ts`, `src/runtime/controlPolicy.test.ts`.

- [ ] **Step 1: Write the table + types** exactly as above. Include EVERY control listed (cross-check against `actions.ts`).
- [ ] **Step 2: Test** that every granular entry has `converge: 'resync'`, every bulk entry `converge: 'self'`, debounced entries have `debounceMs: 16`, and the granular set is exactly `{masterVolume, masterPreamp, inputPreamp, crosspoint, outputGain}`.
  ```ts
  import { CONTROL_POLICY } from './controlPolicy';
  it('granular controls converge via resync', () => {
    for (const k of ['masterVolume','masterPreamp','inputPreamp','crosspoint','outputGain'] as const)
      expect(CONTROL_POLICY[k]).toMatchObject({ strategy: 'granular', converge: 'resync' });
  });
  it('bulk controls self-converge; debounced ones use 16ms', () => {
    expect(CONTROL_POLICY.outputDelay).toMatchObject({ strategy: 'bulk', converge: 'self' });
    expect(CONTROL_POLICY.loudnessRefSpl).toMatchObject({ strategy: 'bulk', converge: 'self', debounceMs: 16 });
  });
  ```
- [ ] **Step 3:** `npm run check` + `npx vitest run src/runtime/controlPolicy.test.ts`. Commit:
  `git commit -m "feat(runtime): add controlPolicy table for the unified outbox (ADR-001)"`

---

## Task 4.2 — THE CUTOVER (build unified outbox, rewire actions, delete old lanes)

**The atomic, high-risk task.** Because the bulk lane has a single global flush state, the new outbox cannot coexist with the old `commit.ts`; replace + rewire + delete together, with the full suite as the gate.

**Files:**
- Rewrite: `src/runtime/outbox.ts` — absorb the granular-lane registry (from `commands.ts`), the bulk rev-lane (from `commit.ts`), and the cross-lane `flush`/`cancel`; expose `enqueue`/`flush`/`cancel`/`applyBaselineConverged`/`convergeBulk`. Preserve invariants G1–G4, B1–B7, X1–X4 verbatim in behavior.
- Delete: `src/runtime/commands.ts`, `src/runtime/commit.ts`.
- Modify: `src/runtime/actions.ts` — replace `scrubCommand`/`commitBulk`/`commitBulkDebounced` calls with `enqueue(...)`; update imports (`applyBaselineConverged`, `flush`/`flushPending`, `cancel`/`cancelAllCommands` now from `./outbox`).
- Modify: `src/runtime/resync.ts` — import `applyBaselineConverged` from `./outbox` (was `./commit`).
- Keep: `src/runtime/focus.ts` (used by granular apply closures).
- Migrate tests: fold `src/runtime/commands.test.ts` + `src/runtime/commit.test.ts` into `src/runtime/outbox.test.ts` (or keep filenames but retarget) — every behavioral test (G/B/X invariants) must survive. Update `actions.test.ts` etc. for the new entry points.

- [ ] **Step 1: Build the new `outbox.ts`.** Port the EXACT mechanics:
  - Granular: copy `makeLane`/`scrubLanes`/`runGuarded`/`claimToken` from `commands.ts`. The granular branch of `enqueue` = the body of the old `scrubCommand` (apply, get device, get-or-make lane, `lane.schedule(() => intent.send(d))`). `runGuarded` keeps G2/G3 (gen captured in `fire()`, resync on success, forceResyncNow on failure). Convergence: for `converge: 'resync'` (all granular today), `runGuarded` calls `scheduleResync()` on success — same as now.
  - Bulk: copy `flush` state, `syncBulkToken`/`BULK_TOKEN`, `flushBulkIfIdle` (with the run-identity teardown B3, re-flush B4, gen guard, `d.hasState` B2, forceResyncNow B7), `trailingTimers`, `convergeBulk`, `drainTrailingTimers`, `awaitBulkSettled`, `cancelBulkFlush` from `commit.ts`. The bulk branch of `enqueue`: `if (!dsp.draft) return; mutate(dsp.draft); flush.currentRev += 1; syncBulkToken();` then if `policy.debounceMs` set the per-`debounceKey` trailing timer (B5) else `flushBulkIfIdle()`.
  - `flush()` = old `flushPending` body (X1) exactly. `cancel()` = old `cancelAllCommands` body (X2) exactly: `cancelAllScrubLanes-equivalent` → `session.generation += 1` → `dsp.pendingWrites.clear()` → `cancelBulkFlush-equivalent`.
  - `applyBaselineConverged(snapshot)` (X3) moves here from `commit.ts`.
  - Export `enqueue`, `flush`, `cancel`, `applyBaselineConverged`, `convergeBulk` (if still needed externally), plus any helper the lifecycle needs. (`drainScrubLanes`/`awaitBulkSettled`/etc. become module-private.)

- [ ] **Step 2: Rewire `actions.ts`.** Mechanical mapping (one `enqueue` per verb):
  - `_setMasterVolume(db)`: `enqueue({ control: 'masterVolume', coalesceKey: 'masterVolume', apply: () => patchSnapshot({ masterVolumeDb: db }), send: (d) => d.setMasterVolume(db) })`.
  - `setMasterPreamp`: `enqueue({ control: 'masterPreamp', coalesceKey: 'masterPreamp', apply, send })`.
  - `setInputPreamp`: `enqueue({ control: 'inputPreamp', coalesceKey: \`inputPreamp:${channel}\`, apply, send })`.
  - `scheduleCrosspointWrite`: `enqueue({ control: 'crosspoint', coalesceKey: \`crosspoint:${input}:${output}\`, apply, send })`.
  - `setOutputGain`: `enqueue({ control: 'outputGain', coalesceKey: \`outputGain:${slot}\`, apply, send })`.
  - Each `commitBulk((s) => …)` → `enqueue({ control: '<name>', mutate: (s) => … })` using the matching control name from the policy table (eqFilter, bypass, channelName, loudnessEnabled, crossfeedEnabled/Preset/Itd, levellerEnabled/Speed/Lookahead, outputDelay, outputEnabled, outputMuted).
  - Each `commitBulkDebounced('key', (s) => …)` → `enqueue({ control: '<name>', debounceKey: '<key>', mutate: (s) => … })` (loudnessRefSpl, loudnessIntensity, crossfeedFreq, crossfeedFeedDb, levellerAmount, levellerMaxGain, levellerGate).
  - Update imports: remove `scrubCommand`/`commitBulk`/`commitBulkDebounced`/`applyBaselineConverged` from `./commands`/`./commit`; import `enqueue`, `applyBaselineConverged`, `flush as flushPending`(or rename call sites), `cancel as cancelAllCommands`(or rename) from `./outbox`. Note: `actions.ts` calls `flushPending()` (factoryReset) and `cancelAllCommands()` (finishConnection scope, transport disconnect) — point them at the new `flush`/`cancel`.

- [ ] **Step 3: Rewire `resync.ts`** — `applyBaselineConverged` now imported from `./outbox`.

- [ ] **Step 4: Delete** `src/runtime/commands.ts` and `src/runtime/commit.ts` (`git rm`). Confirm no remaining imports of them: `rg -n "from './commands'|from './commit'|runtime/commands|runtime/commit" src` → zero.

- [ ] **Step 5: Migrate tests.** Move the behavioral tests from `commands.test.ts` + `commit.test.ts` into `outbox.test.ts`, rewriting their entry points to `enqueue(...)` but PRESERVING every assertion's intent (G1–G4, B1–B7, X1–X4). The detached-stale-send test (B3), the coalesce/re-flush tests (B4), the gen-guard "silent stale settle" test, the per-key scrub coalescing test (G1), the trailing-resync-on-success test (G3) — all must survive. Update `actions.test.ts`, `poll.test.ts`, any test importing the old modules. Do NOT weaken assertions.

- [ ] **Step 6: Gate.**
  - `npm run check` → 0 errors.
  - `npx vitest run` → ALL pass.
  - `npm run test:hil` → HIL suite passes.
  - `npm run lint` → no new errors.
  - `rg -n "scrubCommand|commitBulk|commitBulkDebounced|from './commands'|from './commit'" src` → zero (all replaced by enqueue).
  - **Manual reasoning check:** re-read the new `outbox.ts` against invariants G1–G4/B1–B7/X1–X4 and confirm each is present. (A dedicated reviewer will also do this.)

- [ ] **Step 7: Commit.**
  `git commit -m "refactor(runtime): single outbox + control-policy table; remove dual write lanes (ADR-001)"`

---

## Task 4.3 — Docs

- [ ] **Step 1: Update `docs/ARCH.md`** Layers/Write Paths/Key Files to describe ONE outbox + controlPolicy (replace the Tier A/Tier B two-lane prose). ARCH.md is uncommitted (user owns it) — edit but do NOT commit; flag to user.
- [ ] **Step 2: Final gate** `npm run check && npx vitest run && npm run lint`.

---

## Self-review notes
- **Coverage:** ADR-001's collapse (two lanes + coordinator → one outbox + policy) is delivered by 4.1 + 4.2. Convergence-as-data (resync vs self) lives in the policy.
- **Highest risk:** Task 4.2 Step 1 (porting the bulk run-identity teardown + granular per-key chain + gen-capture timing) and Step 5 (test migration without weakening). The INVARIANTS section is the checklist.
- **Deviation from ADR text:** `focus.ts` is kept (snapshot addressing, not lane coordination). Rationale documented above.
- **Out of scope:** ADR-005 granular-facade split (Phase 5).
