---
name: fw-watch
description: Scan WeebLabs/DSPi firmware branches ahead of main for changes that may require console (App) changes, and write actionable items to a local docs/FW-TODO.md. Use when checking what new firmware development needs accommodating in this console.
---

# DSPi firmware watch (`/fw-watch`)

Track DSPi firmware development on GitHub (`WeebLabs/DSPi`) and surface the changes
that may require corresponding work in this console (the App). Firmware moves on
feature-named branches ahead of `main`; this skill reports what changed on each
such branch since the last run, classified by App impact, into `docs/FW-TODO.md`.

**Optional argument:** a single branch name to scope the run to just that branch.

## Prerequisites

Run `gh auth status`. If it reports not logged in, stop and tell the user to run
`gh auth login`, then exit without modifying any file.

## State

`docs/.fw-watch-state.json` (git-ignored sidecar):

```json
{
  "repo": "WeebLabs/DSPi",
  "baseline": "main",
  "branches": { "crossover-refactor": "<lastSeenSha>" },
  "lastRun": "YYYY-MM-DD"
}
```

If the file is absent, this is a **first run**: create it with empty `branches`,
and seed each discovered branch's watermark to its merge-base with `main` (so the
first report covers everything the branch has added on top of `main`). Do NOT dump
all of `main`'s history.

## Procedure

1. **Auth check** (above).

2. **Read state** from `docs/.fw-watch-state.json` (or initialize for a first run).

3. **Discover branches ahead of `main`.** List branches, then for each (except
   `main`) check whether it is ahead:

   ```bash
   gh api repos/WeebLabs/DSPi/branches --jq '.[].name'
   gh api repos/WeebLabs/DSPi/compare/main...<branch> \
     --jq '{ahead: .ahead_by, base: .merge_base_commit.sha, head: .commits[-1].sha}'
   ```

   Keep branches with `ahead > 0`. If a branch name was passed as an argument,
   restrict to just that branch.

4. **Determine the diff base for each branch:**
   - First sighting (not in state) → base = merge-base (`.merge_base_commit.sha`
     from the `main...<branch>` compare).
   - Already tracked → base = stored watermark SHA.

5. **Collect commits + changed files since the base:**

   ```bash
   gh api repos/WeebLabs/DSPi/compare/<base>...<branch> \
     --jq '.commits[] | "\(.sha[0:7]) \(.commit.message | split("\n")[0])"'
   gh api repos/WeebLabs/DSPi/compare/<base>...<branch> --jq '.files[].filename'
   ```

   If the stored watermark is no longer reachable (compare errors or returns
   `behind > 0` with `ahead == 0`, i.e. the branch was rebased/force-pushed),
   fall back to the merge-base with `main`, re-scan from there, and note the reset
   in the summary.

6. **Filter to console-relevant paths** and pull each one's patch:

   Relevant: `firmware/DSPi/config.h`, `firmware/DSPi/vendor_commands.c`,
   `firmware/DSPi/bulk_params.h`, `firmware/DSPi/bulk_params.c`,
   `firmware/DSPi/usb_descriptors.c`, `firmware/DSPi/usb_descriptors.h`,
   `firmware/DSPi/notify.c`, `firmware/DSPi/notify.h`, and any **new**
   `firmware/DSPi/*.c` / `*.h` feature module.

   Ignore: `Documentation/`, `lufa/`, `pico-extras/`, `*.md`, `CMakeLists.txt`,
   and pure-DSP-math modules with no protocol surface.

   ```bash
   gh api repos/WeebLabs/DSPi/compare/<base>...<branch> \
     --jq '.files[] | select(.filename=="firmware/DSPi/config.h") | .patch'
   ```

7. **Classify each relevant change** against the taxonomy in
   `docs/FW-VERSIONS.md` and write a concrete App-side action:

   | Firmware signal (where) | App-side action |
   |---|---|
   | New `REQ_*` opcode `#define` in `config.h` + handler in `vendor_commands.c` | add `WireCmd` entry, `DspDevice` method, UI gate |
   | `WIRE_FORMAT_VERSION` bumped in `bulk_params.h` | bump `BulkSizes`, extend `bulkLayout()`, parse/build new section |
   | New field in `WireBulkParams` struct | add codec field + conditional read/write in `bulkParser.ts` |
   | Existing struct byte re-meaning (reserved→named) | capability flag; reader/writer unchanged in shape |
   | VID/PID change in `usb_descriptors.*` | update `DSPI_USB_IDS` filter + auto-connect match |
   | New enum value (e.g. filter type) | extend domain enum; UI-gate exposure |
   | New feature module (`*.c`/`*.h`) | new domain model + UI surface; read its spec |
   | `notify.*` change | update notify-channel decode |

   When unsure whether a change needs App work, include it with a "verify"
   qualifier rather than dropping it.

8. **Derive the version annotation** by reading `config.h` on the branch:

   ```bash
   gh api repos/WeebLabs/DSPi/contents/firmware/DSPi/config.h?ref=<branch> \
     -H "Accept: application/vnd.github.raw" \
     | grep -E 'FW_VERSION_(MAJOR|MINOR|PATCH)'
   ```

   Label the section `## <branch> (fw reports X.Y.Z)`. If the version is plainly
   the same as `main`'s release, you may add `→ targets <next>` when the branch
   name makes the target obvious, but never invent a version number.

9. **Merge findings into `docs/FW-TODO.md`** (create with the header below if
   absent). For each branch, ensure a `## <branch> ...` section exists and:
   - **Append** newly found items as unchecked `- [ ]` entries.
   - **Never** modify, reorder, or uncheck existing items — the human owns triage.
   - Skip items already present (match on the source pointer `file@sha` + opcode/
     symbol) to avoid duplicates across runs.
   - Update the section's `_Last reviewed commit_` line to the new branch head.

10. **Advance watermarks:** set each processed branch's entry in
    `state.branches` to its head SHA. Remove entries for branches that no longer
    exist upstream or are no longer ahead of `main` (note them as "merged/gone" in
    the summary, but leave their `FW-TODO.md` section in place). Set
    `state.lastRun` to today's date. Write `docs/.fw-watch-state.json`.

11. **Print a summary**: branches scanned, new items added per branch, any
    resets (rebased branches) or merged/gone branches.

## `docs/FW-TODO.md` format

Create with this header on first run:

```markdown
# DSPi firmware watch

Auto-maintained by `/fw-watch`. Tracks firmware changes on `WeebLabs/DSPi`
branches ahead of `main` that may require console (App) changes. Watermark state
lives in `.fw-watch-state.json`. Both files are local-only (git-ignored).

Triage is manual: check off `- [x]` items you have handled or decided to skip;
the skill never removes or re-checks your items.
```

Each branch section:

```markdown
## crossover-refactor (fw reports 1.1.4 → targets 1.1.5)

_Last reviewed commit: `8100fdb` · updated 2026-06-16_

- [ ] **New opcode `REQ_SET_INPUT_RATE` (0xED)** — `config.h@8100fdb`,
      handler `vendor_commands.c`. App: add `WireCmd.SetInputRate`,
      `DspDevice.setInputRate()`, UI gate behind an input-rate capability.
- [ ] **New module `crossover.c`** — `crossover.c@a8f7605`. App: new crossover
      domain model + UI; read `Documentation/Features/crossover_filters_spec.md`.
```

## Non-goals

- Do not auto-create GitHub issues.
- Do not modify the console's own committed `TODO.md`.
- Do not check off or edit existing `FW-TODO.md` items — triage stays human.
- Do not surface `main`-only released changes (those live in `docs/FW-VERSIONS.md`).
