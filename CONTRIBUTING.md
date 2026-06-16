# Contributing

## Development setup

```bash
npm install          # also installs git hooks via `npm run prepare`
npm run dev          # http://localhost:5173
```

See the [README](./README.md) for browser requirements, the mock device, and
hardware notes.

## Branching model

This project uses **GitHub Flow** on `master`:

- `master` is always deployable. Every merge to `master` auto-deploys to
  [GitHub Pages](https://sigman78.github.io/dspi-web-console/) via
  `.github/workflows/deploy.yml`.
- Do all work on a short-lived branch named for its intent: `feat/…`, `fix/…`,
  `refactor/…`, `chore/…`, `style/…`.
- Open a pull request into `master`. CI must pass before merge.

## Commit messages — Conventional Commits

Commits **must** follow [Conventional Commits](https://www.conventionalcommits.org/),
because release-please derives the next version and the changelog from them:

```
<type>(optional-scope): <summary>
```

Common types and their release effect (pre-1.0 `0.x` line):

| Type | Example | Version effect |
| --- | --- | --- |
| `feat` | `feat(chrome): inline channel rename` | minor bump (`0.1.0` → `0.2.0`) |
| `fix` | `fix(runtime): guard null session on commit` | patch bump (`0.1.0` → `0.1.1`) |
| `refactor`, `perf` | `refactor(state): unify resync path` | patch bump |
| `docs`, `chore`, `style`, `test`, `ci`, `build` | `chore: bump deps` | no release |

A breaking change — `feat!:` / `fix!:` or a `BREAKING CHANGE:` footer — bumps the
**minor** version while on `0.x` (it becomes a major bump once the project reaches
`1.0.0`).

## Quality gate

CI runs on every PR and must be green before merge:

```bash
npm run check        # svelte-check + tsc
npm run lint
npm test             # unit + integration (no hardware)
```

The local `pre-push` hook runs `check + test + build`; `pre-commit` runs
`eslint --fix` on staged files. Bypass with `--no-verify` only when necessary.

## Release process

Releases are automated with
[release-please](https://github.com/googleapis/release-please):

1. Merge feature/fix PRs into `master` using Conventional Commit messages.
2. release-please maintains an open **release PR** that bumps `package.json`,
   updates `CHANGELOG.md`, and lists the changes.
3. Merging the release PR tags `vX.Y.Z`, publishes a **GitHub Release** (the
   "what's new"), and the resulting `master` push redeploys Pages with the new
   version shown in the UI stamp.

No manual version edits — let release-please own `package.json` version and
`CHANGELOG.md`.
