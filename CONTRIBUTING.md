# Contributing to Jevonganize

Thanks for helping. Small, focused pull requests are the easiest to review.

## Set up

You need Node.js 24.22.1 or later and pnpm 12. `.node-version` pins the version we develop on, and
`corepack enable` gives you the right pnpm. No compiler is needed.

```sh
pnpm install
pnpm check     # lint, format, typecheck, knip, tests with coverage, build
```

| Command                                  | What it does                                      |
| ---------------------------------------- | ------------------------------------------------- |
| `pnpm dev scan examples/messy-downloads` | Run the CLI from source, with no build or API key |
| `VITE_MOCK=1 pnpm dev:web`               | Run the UI with Vite, on fictional mock data      |
| `pnpm test`                              | Run unit tests                                    |
| `pnpm test:e2e`                          | Run Playwright tests. Needs `pnpm build` first    |
| `pnpm format`                            | Fix formatting                                    |
| `pnpm dist`                              | Build desktop installers into `release/`          |

`examples/messy-downloads` is messy on purpose, so it makes a good test subject.

VS Code picks up the recommended extensions and format-on-save from `.vscode/`.

A pre-commit hook runs lint, format check and typecheck.

## CI

CI runs `pnpm check` on macOS, Ubuntu and Windows, because tag writing differs per platform. It then
fails if a check rewrote a tracked file. A separate job on macOS runs the Playwright tests and a smoke
test of the packed tarball.

Only macOS has been run so far, so a first failure on Linux or Windows may be a real bug in code no one
has exercised. Please report what you find.

## Principles

- **Less code wins.** Prefer deleting code to adding it, and a reputable library to a hand-written
  version. Do not add a dependency for a few lines.
- **Prefer data to code.** New questions belong in presets, and new formats and providers in their
  tables.
- **Docs change with behaviour.** Update `docs/` in the same pull request.
- **Test the logic.** Tests must not call real providers, and must not touch your real config.
- **No compile step.** Native modules must be Node-API prebuilds, so nobody needs a compiler and
  Electron needs no rebuild.

Read the [architecture overview](docs/architecture.md) and the [contracts](docs/contracts.md) first.
Change a contract in the document before you change the code. [AGENTS.md](AGENTS.md) lists the rules
the code depends on, and they apply to people too.

## Presets

Write built-in presets in your own words. Do not copy text from other products or articles. See
[Writing questions](docs/presets.md#writing-questions).

## Pull requests

1. Open an issue first for anything large.
2. Run `pnpm check`.
3. Add an entry under "Unreleased" in `CHANGELOG.md` if users will notice the change.

By contributing, you agree that your work is licensed under the [MIT License](LICENSE).

## Releasing

None of this has run yet. Expect to fix it on the first release.

1. Move "Unreleased" in `CHANGELOG.md` under a new version.
2. Run `npm version minor && git push --follow-tags`. The `v*` tag starts `release.yml`.
3. The desktop job uploads installers to a draft GitHub Release. Check them, then publish the draft.
4. The npm job stages the package with `npm stage publish`. It goes public only when a maintainer
   approves it with 2FA.

The first npm publish may need the package to exist before trusted publishing accepts it.

Desktop builds are unsigned until a signing identity exists. macOS builds get an ad-hoc signature, so
Apple silicon can run them, and that says nothing about who built them. Users must allow the app in
System Settings > Privacy & Security, and Windows shows a SmartScreen warning. Unsigned macOS builds
get no automatic updates. Test a packaged app after changing `electron-builder.yml`: the fuses have
not been checked against a real build.
