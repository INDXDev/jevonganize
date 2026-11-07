# Contributing to Jevonganize

Thanks for helping. Small, focused pull requests are the easiest to review.

## Set up

You need Node.js 24.22.1 or later on the 24 line, or 26.12.1 or later, and pnpm 12. `.node-version` pins the version we develop on, and
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
fails if a check rewrote a tracked file. A separate job on the same three systems builds the app,
runs the Playwright web tests, checks what the npm tarball would contain, and installs the packed
tarball to run `--help` and a `scan` with no key. The Electron tests run on macOS only.

CI is the only place Linux and Windows have run, so it proves test behaviour and no more. Explorer,
Dolphin and packaged apps there are untried. Please report what you find.

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

See [docs/releasing.md](docs/releasing.md). A release goes to npm and to one GitHub Release with the
three desktop builds, and nowhere else.

Test a packaged app after changing `electron-builder.yml`: the fuses have not been checked against a
real build.
