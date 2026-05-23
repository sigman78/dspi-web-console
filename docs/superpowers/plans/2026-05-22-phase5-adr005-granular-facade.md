# Phase 5 — ADR-005: split the HIL/test-only granular surface into a `DspDeviceGranular` facade

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Shrink the runtime-facing `DspDevice` to exactly the surface the app uses, and relocate the full granular `set*`/`get*` CRUD (used only by unit/HIL tests for wire-codec + hardware cross-checks) into a `DspDeviceGranular extends DspDevice` facade. The runtime-facing API becomes "obviously the way"; the granular CRUD is clearly test-only.

**Scope correction (verified against current code):** The session-start map listed 9 "dead even to tests" methods to DELETE. That is FALSE for the current tree — `setCrossfeedEnabled/Itd/Freq/FeedDb` and `setLeveller{Enabled,Lookahead,MaxGain,Gate}` are all exercised by `src/device/DspDevice.test.ts` (wire-codec round-trip tests that guard the protocol encoders). **No methods are deleted in this phase** — deletion would remove passing contract tests. ADR-005 here is purely the facade split.

**Tech Stack:** Svelte 5, TypeScript, Vitest. Builds on Phases 1–4 (committed).

---

## The split (verified usage map)

**Runtime-facing — STAY on `DspDevice`** (used by `src/runtime`/production):
- Lifecycle/identity: `create`, `close`, `info`, `hardware`.
- Snapshot API: `hasState`, `getSnapshot`, `applyBulk`, `captureState`, `restoreState`, `getAllParams`, `setAllParams`.
- Telemetry: `getSystemStatus`, `getSystemInfo`, `getBufferStats`.
- Granular writes the outbox sends: `setMasterVolume`, `setMasterPreamp`, `setInputPreamp`, `setMasterVolumeMode`, `setMatrixRoute`, `setOutputGain`.
- Actions: `clearClips`, `factoryReset`, `saveMasterVolume`.
- Presets: `getPresetDirectory`, `getActivePreset`, `getPresetName`, `setPresetName`, `savePreset`, `loadPreset`, `deletePreset`, `setPresetStartup`, `setPresetIncludePins`.

**Test/HIL-only — MOVE to `DspDeviceGranular`** (zero production callers; referenced only by `*.test.ts` / `*.hil.test.ts`):
`setFilter`, `getFilter`, `setBypass`, `getBypass`, `getMasterPreamp`, `getInputPreamp`, `getMasterVolume`, `getMasterVolumeMode`, `getSavedMasterVolume`, `getMatrixRoute`, `setOutputEnable`, `getOutputEnable`, `getOutputGain`, `setOutputMute`, `getOutputMute`, `setOutputDelay`, `getOutputDelay`, `setChannelName`, `getChannelName`, `getPresetStartup`, `getPresetIncludePins`, `saveParams`, `loadParams`, `resetBufferStats`, `clearAllPresets`, `setLoudnessEnabled`, `setLoudnessRefSpl`, `setLoudnessIntensity`, `setCrossfeedEnabled`, `setCrossfeedPreset`, `setCrossfeedItd`, `setCrossfeedFreq`, `setCrossfeedFeedDb`, `setLevellerEnabled`, `setLevellerSpeed`, `setLevellerLookahead`, `setLevellerAmount`, `setLevellerMaxGain`, `setLevellerGate`.

These moved methods use `this.transport`, `this.#deviceChannel`, and the wire codecs — so the subclass needs access to those.

---

## Task 5.1 — make `DspDevice` subclassable + create `DspDeviceGranular`; relocate methods; update construction sites

**Files:**
- Modify: `src/device/DspDevice.ts` — open up for subclassing; remove the moved methods.
- Create: `src/device/DspDeviceGranular.ts` — `class DspDeviceGranular extends DspDevice` holding the moved methods.
- Modify: `test/hil/setup.ts` (the `@test/hil/setup` `openSingleDevice`) — return a `DspDeviceGranular`.
- Modify: test construction sites that call a moved method on a real device: `src/device/DspDevice.test.ts`, `src/transport/MockTransport.test.ts`, `src/runtime/presets.test.ts` (and any other flagged by `tsc`).

- [ ] **Step 1: Open `DspDevice` for subclassing.** In `src/device/DspDevice.ts`:
  - `private constructor(...)` → `protected constructor(...)` (a `private` constructor cannot be subclassed).
  - `private readonly transport: DspTransport` → `protected readonly transport: DspTransport`.
  - `#deviceChannel(channel)` (true-private) → `protected deviceChannel(channel: ChannelId): ChannelId` (rename usages within DspDevice if any remain after the move — only the moved methods use it, so after Step 3 the base may not call it; keep the protected method for the subclass).
  - Make `create` polymorphic so the subclass inherits a correctly-typed factory:
    ```ts
    static async create<T extends DspDevice>(
      this: new (transport: DspTransport, info: DspDeviceInfo) => T,
      transport: DspTransport,
      openTransport: () => Promise<void> = () => transport.open(),
    ): Promise<T> {
      await openTransport();
      const [serial, platform] = await Promise.all([
        readCmd(transport, WireCmd.GetSerial),
        readCmd(transport, WireCmd.GetPlatform),
      ]);
      const platformType = platformTypeFromId(platform.platformId);
      const hardware = createHardwareProfile(platformType);
      return new this(transport, {
        serial: serial.trim(),
        firmwareVersion: firmwareVersion(platform),
        platformType, hardware,
      });
    }
    ```
    Now `DspDevice.create(t)` → `DspDevice` and `DspDeviceGranular.create(t)` → `DspDeviceGranular`. If the polymorphic-`this` typing fights the compiler, fall back to extracting a `protected static async resolveInfo(transport, openTransport): Promise<DspDeviceInfo>` and giving each class its own thin `create`. Report which approach you used.

- [ ] **Step 2: Create `src/device/DspDeviceGranular.ts`.**
  ```ts
  // HIL / unit-test facade. Holds the full granular set*/get* CRUD that the
  // runtime never calls — it exists for wire-codec round-trip tests and
  // hardware-in-the-loop cross-checks (HW-DSPUSB.md). Production constructs
  // `DspDevice`; tests construct `DspDeviceGranular`.
  import { /* WireCmd, writeCmd, readCmd, actionCmd, Codec, codecs… */ } from '@/protocol';
  import { /* types: ChannelId, InputSlot, OutputSlot, FilterParams, FilterType,
            CrossfeedPreset, LevellerSpeed, MasterVolumeMode, PresetSlot,
            PresetResult, FlashResult, CHANNEL_NAME_MAX_LEN, PRESET_NAME_MAX_LEN… */ } from '@/domain' /* and '@/protocol' / '@/utils' as needed */;
  import { DspDevice } from './DspDevice';

  export class DspDeviceGranular extends DspDevice {
    // ... all 38 moved methods verbatim, with `this.#deviceChannel(` rewritten
    // to `this.deviceChannel(` and `this.transport` unchanged (now protected) ...
  }
  ```
  Move each method body VERBATIM from `DspDevice.ts` (only change `this.#deviceChannel(` → `this.deviceChannel(`). Bring over exactly the imports those methods need. Do NOT change any wire logic.

- [ ] **Step 3: Remove the moved methods from `DspDevice.ts`.** Delete the 38 method definitions listed above from the base class. Remove now-unused imports from `DspDevice.ts` (e.g. `FilterType`/`FilterParams`/`CrossfeedPreset`/`LevellerSpeed` if only the moved methods used them; `utf8Truncate` if only setChannelName/setPresetName used it — note setPresetName STAYS, so `utf8Truncate` + `PRESET_NAME_MAX_LEN` stay; `CHANNEL_NAME_MAX_LEN` moves to the facade if only setChannelName used it). Let `tsc` guide unused-import cleanup. Keep `protected deviceChannel` on the base (the subclass uses it).

- [ ] **Step 4: Update the HIL setup.** In `test/hil/setup.ts` (resolve the `@test/hil` alias — likely `test/hil/setup.ts`), change `openSingleDevice()` so the returned `device` is a `DspDeviceGranular` (`DspDeviceGranular.create(transport)`), and update its return type. All HIL tests then get the granular surface. (Production never imports this file.)

- [ ] **Step 5: Update unit-test construction sites.** Run `npm run check` — `tsc` will flag every call to a moved method on a `DspDevice`-typed value. For each, switch that test's device construction from `DspDevice.create(...)` to `DspDeviceGranular.create(...)` (and the import). Known sites: `src/device/DspDevice.test.ts` (the big codec test — likely a local `makeDevice` helper → make it return DspDeviceGranular), `src/transport/MockTransport.test.ts`, `src/runtime/presets.test.ts` (its setup uses `setLoudnessEnabled` — if it builds a real device, use granular; if it uses a structural mock object, no change). Do NOT change test assertions — only the constructed type.

- [ ] **Step 6: Verify.**
  - `npm run check` → 0 errors.
  - `npx vitest run` → all pass (425).
  - `npm run lint` → no new errors.
  - `npm run test:hil` → best-effort (needs hardware; the one pre-existing preset-name flake is unrelated). At minimum it must COMPILE/load (the granular methods resolve on the granular device).
  - `rg -n "class DspDevice\b" src/device/DspDevice.ts` and confirm the base no longer defines any of the 38 moved methods: `rg -n "setFilter|setBypass|setOutputDelay|setLoudnessEnabled|setCrossfeedFreq|setLevellerGate|clearAllPresets|getSavedMasterVolume" src/device/DspDevice.ts` → ZERO.
  - Confirm production still type-checks against the lean `DspDevice` (no production file referenced a moved method — verified in planning).

- [ ] **Step 7: Commit.**
  `git commit -m "refactor(device): split HIL-only granular CRUD into DspDeviceGranular facade (ADR-005)"`

---

## Task 5.2 — Docs

- [ ] **Step 1: Update `docs/ARCH.md`** Key Files / any device-surface prose: note `DspDevice` is the lean runtime-facing surface and `DspDeviceGranular` (test/HIL-only) holds the granular CRUD. ARCH.md is uncommitted (user owns it) — edit, do not commit; flag to user.
- [ ] **Step 2: Final gate** `npm run check && npx vitest run && npm run lint`.

---

## Self-review notes
- **Coverage:** ADR-005's facade split is delivered by 5.1. The "delete dead methods" sub-goal is intentionally dropped — corrected against current tests (the methods have wire-codec coverage). Flag this correction to the user.
- **Risk:** low–medium. `tsc` catches every missed reference (a moved method on a `DspDevice` value errors). No wire logic changes. The only design choice is the polymorphic-`this` factory vs a `resolveInfo` helper.
- **Encapsulation note:** `transport`/constructor become `protected` (was `private`). Still non-public — production cannot `new` the device or read `transport`; only the test-only subclass can. Acceptable.
- **This completes the ADR-2026-05-22 refactor (ADRs 001–006).**
