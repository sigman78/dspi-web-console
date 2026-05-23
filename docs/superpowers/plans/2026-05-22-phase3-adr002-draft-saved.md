# Phase 3 — ADR-002: `draft`/`saved` rename + cell encapsulation (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rename the two store cells `live`→`draft` and `shadow`→`saved`, and encapsulate them so external modules can read but not assign them — all mutation goes through verbs. (`wireBase` was already removed in Phase 2.)

**Architecture:** `src/state/dsp.svelte.ts` exposes `dsp` as a **readonly view** (`DspStore`) plus mutation verbs. The `$state` cells live on a module-private impl instance; only the verbs in this file assign them. Reads (`dsp.draft?.channels`) are unchanged everywhere; external assignment becomes a compile error.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest.

**Source:** `ADN-2026-05-22.md` ADR-002 + board review A4. Builds on Phases 1–2 (committed).

**Footprint (measured):** ~221 `dsp.live` + ~45 `dsp.shadow` occurrences across 23 production files + tests. Production code never assigns `dsp.live`/`dsp.shadow` (only tests do) — confirmed by grep. `tsc` is the safety net: any missed read becomes "Property 'live' does not exist".

---

## Naming (use verbatim)

| Old | New |
|---|---|
| `dsp.live` | `dsp.draft` |
| `dsp.shadow` | `dsp.saved` |
| `applyLiveSnapshot` | `applyDraftSnapshot` |
| `refreshShadowFromLive` | `refreshSavedFromDraft` |
| `applyBaselineSnapshot` | (unchanged — sets both cells) |
| `patchSnapshot`, `resetDsp`, `isInFlight` | (unchanged) |

Comments referring to the cells conceptually ("live"/"shadow") update to "draft"/"saved".

---

## Task 3.1 — Mechanical rename (behavior-preserving)

Rename the cells, the two verbs, all readers, and comments. Tests keep assigning `dsp.draft = …` directly for now (encapsulation is Task 3.2). After this task `rg -n "dsp\.live|dsp\.shadow|applyLiveSnapshot|refreshShadowFromLive" src` returns zero.

**Files:** `src/state/dsp.svelte.ts` (+ its tests), `src/state/presets.svelte.ts`, `src/domain/presetDiff.ts` (param names only if they use live/shadow), `src/runtime/{commit,resync,presets,actions,focus}.ts`, all `src/components/**` reading `dsp.live`, `src/domain/{channels,bode/filterCurve}.ts`, `src/main.ts`, `src/state/settings.svelte.ts`, and all affected `*.test.ts`.

- [ ] **Step 1: Rename in `src/state/dsp.svelte.ts`.**
  - `DspState` interface: `live` → `draft`, `shadow` → `saved` (update their doc comments).
  - `DspStateImpl`: `live`/`shadow` fields → `draft`/`saved`.
  - The header matrix comment: column headers `live | shadow` → `draft | saved`; verb rows updated (`applyLiveSnapshot`→`applyDraftSnapshot`, `refreshShadowFromLive`→`refreshSavedFromDraft`).
  - `applyBaseline`: `dsp.live`→`dsp.draft`, `dsp.shadow = structuredClone` → `dsp.saved = structuredClone`.
  - `applyLiveSnapshot` → rename to `applyDraftSnapshot`; body `dsp.live` → `dsp.draft`.
  - `resetDsp`: `dsp.live = null` → `dsp.draft = null`; comment "dsp.shadow ... survives" → "dsp.saved ... survives".
  - `patchSnapshot`: `dsp.live` → `dsp.draft`; comment "touches `live` only; shadow" → "touches `draft` only; saved".
  - `refreshShadowFromLive` → rename to `refreshSavedFromDraft`; body `dsp.live`/`dsp.shadow` → `dsp.draft`/`dsp.saved`; update its comment ("Copy current draft > saved").

- [ ] **Step 2: Global rename of reads across the codebase.** Apply these exact textual replacements across all of `src/` (production + tests), then fix the verb call sites:
  - `dsp.live` → `dsp.draft`
  - `dsp.shadow` → `dsp.saved`
  - `applyLiveSnapshot` → `applyDraftSnapshot` (call sites: `src/runtime/resync.ts:21` + its import line 1; `src/state/dsp.svelte.test.ts`)
  - `refreshShadowFromLive` → `refreshSavedFromDraft` (call sites: `src/runtime/presets.ts:5,151,184`; `src/state/dsp.test.ts`)
  These tokens are unambiguous (the only `.live`/`.shadow` accessors in the repo are on `dsp`). Verify with grep after.

- [ ] **Step 3: `src/state/presets.svelte.ts`** `presetsDirty.current`: `dsp.live`/`dsp.shadow` → `dsp.draft`/`dsp.saved`; in `presetDiff(dsp.shadow, dsp.live, …)` → `presetDiff(dsp.saved, dsp.draft, …)`.

- [ ] **Step 4: `src/domain/presetDiff.ts`** — read it. If its parameters are named `live`/`shadow` (or `baseline`/`current`), only rename them if they say live/shadow; otherwise leave (it's a pure function over two snapshots). Do NOT change its logic.

- [ ] **Step 5: Comments sweep in touched files.** Update prose that names the cells: e.g. `resync.ts` "re-baseline shadow … refreshShadowFromLive" → "re-baseline saved … refreshSavedFromDraft"; `focus.ts:17` "dsp.live === null" → "dsp.draft === null"; `presets.svelte.ts` comments. Keep wording accurate.

- [ ] **Step 6: Verify (gate).**
  - `npm run check` → 0 errors (this catches every missed read).
  - `npx vitest run` → all pass (same count as Phase 2 end: 421).
  - `npm run lint` → no new errors.
  - `rg -n "dsp\.live|dsp\.shadow|applyLiveSnapshot|refreshShadowFromLive" src` → ZERO.

- [ ] **Step 7: Commit.**
  ```bash
  git add -A   # review `git status` first; do NOT stage docs/ARCH.md, docs/HW-DSPUSB.md, or untracked planning docs; do NOT touch the stash
  git commit -m "refactor(state): rename live->draft, shadow->saved (ADR-002)"
  ```

---

## Task 3.2 — Encapsulate the cells behind a readonly view + verbs

Make `dsp` a readonly view so no external module can assign `dsp.draft`/`dsp.saved`; all mutation flows through the verbs. Migrate the test files that assign cells directly to use verbs.

**Files:** `src/state/dsp.svelte.ts`, and the test files that assign `dsp.draft`/`dsp.saved` directly (`src/runtime/commands.test.ts`, `src/runtime/actions.test.ts`, `src/runtime/poll.test.ts`, and any state tests).

- [ ] **Step 1: Split impl from view in `src/state/dsp.svelte.ts`.**
  ```ts
  // Module-private mutable instance — only the verbs below assign its cells.
  class DspStateImpl {
    draft = $state<DspSnapshot | null>(null);
    saved = $state<DspSnapshot | null>(null);
    pendingWrites = $state(new SvelteSet<symbol>());
  }
  const state = new DspStateImpl();

  // Public read-only view. External modules read draft/saved and call the
  // verbs; they cannot assign the cells (compile error). pendingWrites is
  // readonly-as-a-reference but its .add()/.delete() still work for the
  // command lanes that track in-flight tokens.
  export interface DspStore {
    readonly draft: DspSnapshot | null;
    readonly saved: DspSnapshot | null;
    readonly pendingWrites: SvelteSet<symbol>;
  }
  export const dsp: DspStore = state;
  ```
  Update every verb in this file to assign `state.draft`/`state.saved`/`state.pendingWrites` (NOT `dsp.…`). Reads inside verbs may use `state` too. `isInFlight` reads `state.pendingWrites.size` (or `dsp.pendingWrites.size` — both fine). Delete the now-redundant `DspState` interface (replaced by `DspStore`) unless something imports it — grep `DspState\b` first; if imported elsewhere, keep an alias.

- [ ] **Step 2: Confirm production compiles.** `npm run check`. Production code only READS `dsp.draft`/`dsp.saved` and calls `.add/.delete` on `pendingWrites` (verified by the Phase-3 footprint grep) — so production needs no change. If `tsc` flags a production assignment, that is a real encapsulation violation to route through a verb (report it).

- [ ] **Step 3: Migrate test cell-assignments to verbs.** `tsc`/test compile will now flag every `dsp.draft = X` / `dsp.saved = X` in tests. For each, replace with the verb matching the test's intent:
  - `dsp.draft = fromBulkParams(...)` seeding both-equal baseline → `applyBaselineSnapshot(fromBulkParams(...))` IF the test wants draft==saved; if it wants draft set but saved untouched/null, use `applyDraftSnapshot(...)`. Read each test to pick correctly (a dirty-state test needs draft≠saved, so seed `applyBaselineSnapshot` then `applyDraftSnapshot` or `patchSnapshot` to diverge).
  - `dsp.draft = null` → `resetDsp()` if clearing is the intent (note it also clears pendingWrites + keeps saved); if a test needs ONLY draft null with pendingWrites intact, add a narrowly-scoped test helper or adjust the assertion. Prefer `resetDsp()` where intent matches.
  - Do NOT weaken assertions; preserve each test's intent. Run the full suite after each test file.

- [ ] **Step 4: Update the header matrix comment** in `dsp.svelte.ts` to note the cells are now private behind the `DspStore` readonly view (mutation only via verbs).

- [ ] **Step 5: Verify (gate).** `npm run check` → 0 errors. `npx vitest run` → all pass. `npm run lint` → no new errors. Spot-check: adding `dsp.draft = null as any` in a scratch line should error (then remove it) — confirms the view is readonly. (Optional sanity; don't commit the scratch line.)

- [ ] **Step 6: Commit.**
  ```bash
  git add -A   # same staging caution as 3.1
  git commit -m "refactor(state): encapsulate draft/saved behind a readonly view (ADR-002 / board review A4)"
  ```

---

## Task 3.3 — Docs

- [ ] **Step 1: Update `docs/ARCH.md` State Model** to `draft`/`saved` + the readonly-view note. ARCH.md is an uncommitted working-tree rewrite the user owns — make the edit but do NOT commit it; flag to the user.
- [ ] **Step 2: Final gate** `npm run check && npx vitest run && npm run lint` — all green.

---

## Self-review notes
- **Coverage:** ADR-002's remaining scope (rename + encapsulation; wireBase already gone) is fully covered by 3.1 + 3.2.
- **Risk:** mostly mechanical; `tsc` catches missed renames. The judgment is in Task 3.2 Step 3 (test-intent-preserving migration of direct cell assignments).
- **Type names fixed here:** `draft`, `saved`, `applyDraftSnapshot`, `refreshSavedFromDraft`, `DspStore`. Phase 4 (ADR-001 outbox) builds on these.
- **Out of scope:** outbox/control-policy (Phase 4), granular facade split (Phase 5).
