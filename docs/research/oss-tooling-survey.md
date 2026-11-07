# OSS tooling survey

Date: 2026-11-06. Scope: test the Jevonganize toolchain (`app-shell-and-ui.md`, section 6 and Summary) against what eight popular, active repositories actually configure.

Evidence labels:

- **[config]**: read in the repository's config files, shallow clone of 2026-11-06. Nothing from the clones was installed or run.
- **[tested]**: run in a throwaway project on this machine (macOS arm64, Node 24.22.1, pnpm 12.16.1). The project held our own stub code, not repository code.
- **[registry]**: read from the npm registry, `api.npmjs.org` or the GitHub API on 2026-11-06.
- **[not run]**: written but not executed.

## Summary

The survey confirms most of the stack and overturns one choice.

- **Replace Biome with `oxlint` + `oxlint-tsgolint` + `oxfmt`.** Biome is in 0 of 8 repositories. oxlint is the main linter in 6 of 8 and oxfmt the formatter in 5 of 8. The move also buys type-aware rules, an import-cycle check and layer boundaries that Biome's `preset: none` setup in `jevlint` does not use.
- **Move pnpm from 10.11.0 to 12.16.1.** Five of the six pnpm repositories are on 12.x. pnpm 12 ignores `node-linker` in `.npmrc`, so section 6's note needs changing.
- **Add** `knip`, `husky`, `@vitest/coverage-v8`, `@playwright/test`, Renovate and CodeQL default setup.
- **Keep** single package, vitest 5, tsdown, TypeScript 7, Electron 45, electron-builder, Hono, React 19, Vite 8, Tailwind 4, shadcn on Radix.
- **Keep skipping** Changesets, Turborepo, Storybook, a docs site. The survey adds commitlint, lint-staged, lefthook, spell checkers, zizmor, Scorecard, publint and Vite+ to the skip list.

Open risk 6 (TypeScript 7 with Hono RPC types) is closed for the basic case: a typed `hc<App>` client resolved `json()` to the right shape, and `tsc` 7.0.2 caught a wrong assignment **[tested]**.

## Repositories

Selected with `gh api` on 2026-11-06. `vercel/ai` and `lobehub` show `NOASSERTION` on GitHub, so their licences were read from the `LICENSE` file.

| Repository | Stars | Last push | Licence | Why it is close |
| --- | --- | --- | --- | --- |
| `karakeep-app/karakeep` | 30.3k | 2026-11-04 | AGPL-3.0 | AI tagging, Hono, CLI, MCP |
| `papra-hq/papra` | 5.7k | 2026-11-05 | AGPL-3.0 | Documents, tagging rules, Hono, CLI |
| `CherryHQ/cherry-studio` | 53.3k | 2026-11-05 | AGPL-3.0 | Electron 45 + AI |
| `lobehub/lobehub` | 84.0k | 2026-11-05 | LobeHub Community License | Electron + AI, heaviest tooling |
| `tagspaces/tagspaces` | 5.4k | 2026-11-03 | AGPL-3.0 (dual, with proprietary Pro) | File tags, Electron |
| `usebruno/bruno` | 48.2k | 2026-11-05 | MIT | Local-first Electron app + CLI |
| `vercel/ai` | 27.8k | 2026-11-05 | Apache-2.0 | Our LLM dependency, tooling exemplar |
| `honojs/hono` | 32.8k | 2026-11-05 | MIT | Our server; the nearest thing to a single package |

Rejected as stale: `t3-oss/create-t3-app` (last push 2025-12-13), `t3-oss/t3-env` (2026-04-01). Not cloned because the eight above already cover the shape: `hoppscotch`, `excalidraw`, `Effect-TS/effect`. `tldraw` was cloned, then dropped to stay within eight: it has no server or Electron.

## Adoption tables

All cells are **[config]**. A dash means nothing was found.

### Package manager and structure

| Repository | Manager and pin | Node pin | Layout | Task runner |
| --- | --- | --- | --- | --- |
| karakeep | `pnpm@11.28.9` | `.nvmrc` 24 | Monorepo: `apps/`, `packages/`, `tooling/` | Turborepo |
| papra | `pnpm@12.4.2` | `.nvmrc` 26.12.1 | Monorepo: `apps/`, `packages/`; pnpm catalogs | `pnpm -r` |
| cherry-studio | `pnpm@12.6.0+sha512` | `.node-version` 24.18.1, `engineStrict` | App in root `src/` plus `packages/` | Custom `scripts/validation/run.mjs` |
| lobehub | `pnpm@12.4.1+sha512`, `lockfile: false` | `.nvmrc` lts/krypton | App in root `src/` plus `packages/`, `apps/desktop` | Bun scripts |
| tagspaces | npm, `package-lock.json` | `engines` >=22 | Single package plus `release/app` | npm scripts |
| bruno | npm workspaces | `.nvmrc` 24.22.1 | Monorepo: `packages/` | npm scripts |
| vercel/ai | `pnpm@12.14.0` | `engines` | Monorepo, about 100 packages | Turborepo |
| hono | `pnpm@12.6.0` | `.tool-versions` | Effectively one package; `adapters/*` on the side | Vite+ (`vp`) |

### Code quality

| Repository | Linter | Formatter | Type check | Dead code and dependencies |
| --- | --- | --- | --- | --- |
| karakeep | oxlint 1.87 | oxfmt 0.72 | `tsc`, TypeScript ^7.0.2 | `sherif` |
| papra | oxlint 1.89, `typeAware` and `typeCheck` | oxfmt 0.74 | TypeScript ^7.0.2 (catalog keeps 6 as legacy), `oxlint-tsgolint` | - |
| cherry-studio | oxlint 1.76 `typeAware`, then ESLint 9 in the same `lint` script | oxfmt 0.61 | `tsc`; TypeScript 6 and 7 installed under aliases, `oxlint-tsgolint` | Custom scripts |
| lobehub | oxlint 1.90, stylelint, remark; ESLint 10 only in a sub-package | Prettier 3 | `tsrs` 0.20 beta, TypeScript 6 | `knip`, `dpdm` |
| tagspaces | ESLint 8 (legacy config) | Prettier 3 | `tsc`, TypeScript 5.9 | - |
| bruno | ESLint 9 flat, `@stylistic` | - (`@stylistic` rules; Prettier 2 installed) | Mostly JavaScript | - |
| vercel/ai | oxlint via `ultracite`, plus a repo-local JS plugin | oxfmt via `ultracite` | `tsc --build`, TypeScript 6 | `publint`, `konsistent`, `import/no-cycle` |
| hono | oxlint via `vp lint` | oxfmt via `vp fmt` | `tsc`, TypeScript 6; `@typescript/native-preview` installed | `publint`, `editorconfig-checker` |

Nobody has `biome.json`. Nobody uses `depcheck`, `syncpack`, `typos` or `cspell`.

### Build and tests

| Repository | Bundler | Unit tests | End to end |
| --- | --- | --- | --- |
| karakeep | tsdown, Vite (CLI), Next.js | vitest 4 | vitest against Docker |
| papra | tsdown (packages), esbuild (server), Vite (client) | vitest 4, coverage-v8 | Smoke test of the built server |
| cherry-studio | electron-vite 6 beta, Vite 8, tsdown (packages) | vitest 5, coverage-v8 | Playwright `_electron`, one worker |
| lobehub | Vite 8, tsdown and tsup (packages) | vitest 5, coverage-v8, Codecov | Cucumber + Playwright on the web build |
| tagspaces | webpack 5 | Playwright runner | Playwright for Electron and web |
| bruno | Rsbuild | Jest 29 | Playwright `_electron`, `xvfb-run` on Linux |
| vercel/ai | tsdown | vitest 4 | Playwright in examples only |
| hono | tsdown via `vp pack` | vitest 5 via `vp test`, coverage-v8, Codecov | Runtime tests for Deno, Bun, workerd |

### Hooks, commits, release

| Repository | Hooks | Commit rule | Release | npm provenance |
| --- | --- | --- | --- | --- |
| karakeep | husky: runs the whole `preflight`, no staging filter | - | Per-target workflows | OIDC `id-token` (CLI, SDK, MCP) |
| papra | - | Conventional Commits, documented only | Changesets | OIDC |
| cherry-studio | `prek` (`.pre-commit-config.yaml`) | DCO `--signoff` | Changesets for packages, own scripts for the app | OIDC (packages) |
| lobehub | Raw `.githooks` + lint-staged | commitlint, gitmoji | semantic-release | `--provenance` |
| tagspaces | husky: Prettier, typecheck, tests | - | electron-builder `--publish always` | Not published to npm |
| bruno | husky + nano-staged | - | Manual workflows | None found |
| vercel/ai | husky + lint-staged | - | Changesets | OIDC |
| hono | - | - | `np --no-publish`, then a `v*` tag | `npm stage publish --provenance` |

### Dependencies, CI, security

| Repository | Update bot | CI matrix | Cache | Action pinning | Scans |
| --- | --- | --- | --- | --- | --- |
| karakeep | - | ubuntu, one job per check | setup-node `cache: pnpm` | `actions.lock` verified in CI | - |
| papra | Renovate `config:best-practices` | ubuntu | setup-node `cache: pnpm` | SHA | - |
| cherry-studio | Dependabot (Actions only) | ubuntu sharded; macOS and Windows jobs | `actions/cache` | Tag | actionlint |
| lobehub | Renovate | ubuntu, Windows | `actions/cache` | Tag | CodeQL |
| tagspaces | - | macOS, Windows | `actions/cache` | Tag | CodeQL |
| bruno | Dependabot | One workflow each for Linux, macOS, Windows | Shared composite action | Tag | - |
| vercel/ai | Dependabot, migrated from Renovate | ubuntu, Windows | Turborepo remote cache | SHA | Socket config |
| hono | - | ubuntu, Windows | `pnpm/action-setup` `cache: true` | SHA | - |

No repository uses zizmor or OpenSSF Scorecard. Seven of eight have a `SECURITY.md`; hono does not.

pnpm supply-chain settings: `allowBuilds` in all six pnpm repositories, `minimumReleaseAge: 4320` in vercel/ai, `trustPolicy: no-downgrade` and `blockExoticSubdeps` in karakeep.

### Electron

| Repository | Electron | Packaging | Signing | Updates | Fuses |
| --- | --- | --- | --- | --- | --- |
| cherry-studio | 45.2.2 | electron-builder 26.15.6, default pnpm linker | `afterSign` notarize script, custom Windows `signtool` script | `electron-updater` 6.7.0 (patched), generic provider on its own CDN | - |
| lobehub | 44.5.1 | electron-builder 26.18.0, `shamefullyHoist: true` | Own notarize step; `hardenedRuntime` only when a certificate exists | `electron-updater`, generic S3, Sparkle, GitHub fallback | - |
| tagspaces | 45.2.1 | electron-builder 26.8.1 | Not visible in public CI | No `electron-updater`; checks a version JSON file and tells the user | - |
| bruno | 43.8.4 | electron-builder 26.18.0 | `afterSign` with `@electron/notarize` | No auto-updater found in `bruno-electron/src` | - |

electron-builder is 4 of 4; Forge is 0 of 4. Nobody sets fuses in the builder config. Our `@electron/fuses` plan is ahead of the survey, so keep it, but no repository here is a reference for it.

### Docs, agents, the rest

| Repository | Docs site | Agent files | Devcontainer | Storybook | i18n |
| --- | --- | --- | --- | --- | --- |
| karakeep | Docusaurus | `AGENTS.md`, `CLAUDE.md` linked, `skills/` | - | - | i18next |
| papra | Starlight | - | - | - | Own typed dictionaries |
| cherry-studio | In-repo `docs/website` | `CLAUDE.md`, `AGENTS.md` linked, `DESIGN.md` | - | Yes (`packages/ui`) | i18next + `i18next-cli` |
| lobehub | MDX in `docs/`, rendered elsewhere | `AGENTS.md`, `DESIGN.md`, `.agents/` | Yes | - | i18next |
| tagspaces | - | `CLAUDE.md` (321 lines) | - | - | i18next |
| bruno | - | `.claude/CLAUDE.md` | - | Yes | i18next |
| vercel/ai | Fumadocs | `AGENTS.md`, `skills/`, `architecture/`, `contributing/` | - | - | Not applicable |
| hono | Separate repository | - | - | - | Not applicable |

### Tally

| Tool | Repositories |
| --- | --- |
| pnpm | 6 of 8 (5 on 12.x) |
| Monorepo | 6 of 8 (hono and tagspaces are near-single) |
| oxlint main linter | 6 of 8 |
| oxfmt | 5 of 8 |
| Biome | **0 of 8** |
| TypeScript 7 on the type-check path | 2 of 8 clearly (karakeep, papra); 2 more install it (cherry-studio, hono) |
| tsdown | 6 of 8 |
| Vite for an app | 4 of 8 |
| vitest | 6 of 8 |
| Playwright end to end | 4 of 8 (3 of 4 Electron apps drive Electron itself) |
| husky | 4 of 8 |
| lefthook | 0 of 8 |
| lint-staged | 2 of 8 |
| commitlint | 1 of 8 |
| Changesets | 3 of 8, all multi-package |
| release-please | 0 of 8 |
| knip | 1 of 8 |
| publint | 2 of 8, both libraries |
| Renovate / Dependabot | 2 / 3 of 8 |
| CodeQL | 2 of 8 |
| SHA-pinned Actions | 3 of 8, plus karakeep's lock file |
| OIDC or `--provenance` on npm publish | 6 of 8 (not tagspaces, which skips npm, or bruno) |
| `AGENTS.md` | 4 of 8; 6 of 8 have some agent file |
| i18next | 5 of the 6 apps |
| Storybook | 2 of 8 |
| Devcontainer | 1 of 8 |

Stack checks: Hono runs the server in karakeep and papra. shadcn `components.json` appears in karakeep, cherry-studio and papra's Solid port. Radix is in karakeep and cherry-studio; `@base-ui/react` in lobehub. Tailwind 4 in cherry-studio, Tailwind 3 in karakeep and bruno. `@modelcontextprotocol/server` v2 is already in karakeep, cherry-studio and lobehub, and lobehub lints against importing the v1 SDK. Nothing here argues for changing the UI picks.

## Recommended toolchain

Versions are the registry's latest on 2026-11-06, except `oxlint-tsgolint`, held back because 7.0.2006 is under a day old. Weekly downloads are for the last week **[registry]**.

### Changed

| Package | Version | Weekly | Used by | What it buys |
| --- | --- | --- | --- | --- |
| `oxlint` | 1.91.0 | 43.6M | 6 of 8 | Replaces Biome's linter. Full lint of the stub project ran in 0.3 to 0.8 s **[tested]**. Import cycles and layer boundaries with no extra tool. |
| `oxlint-tsgolint` | 7.0.2005 | 21.5M | 2 of 8 directly, 1 via Vite+ | Type-aware rules such as `no-floating-promises`, which matter for a file-writing async pipeline. Built on the TypeScript 7 compiler. |
| `oxfmt` | 0.76.0 | 27.5M | 5 of 8 | Replaces Biome's formatter. Also sorts `package.json` and Tailwind classes, which removes the need for a plugin **[tested]**. |
| `pnpm` | 12.16.1 | 318M | 5 of 8 on 12.x | Install-time supply-chain policy (below). `jevlint`'s 10.11.0 predates it. |

Biome leaves. `jevlint`'s `biome.json` sets `linter.rules.preset: none`, so it was only ever a formatter there, and the two settings that matter (width 100, single quotes) carry over exactly. The cost is that Jevonganize and `jevlint` no longer share a formatter. oxfmt is pre-1.0: pin it exactly and expect churn on upgrade.

### Added

| Package or service | Version | Weekly | Used by | What it buys |
| --- | --- | --- | --- | --- |
| `@playwright/test` | 1.64.1 | 108M | 4 of 8 | The only way to prove the packaged shell boots. An `_electron` smoke test passed against Electron 45.2.3 **[tested]**. Also drives the web UI. |
| `@vitest/coverage-v8` | 5.1.0 | 60M | 4 of 8 | Coverage gate on `src/core` and `src/ai`, the code we own. No Codecov. |
| `knip` | 6.44.1 | 28.6M | 1 of 8 | Low adoption here, but the most useful result of the spike: unused files, exports and dependencies in one command, and the config is 8 lines. It found every planted item and understood `husky` and `oxlint-tsgolint` without help **[tested]**. Keeps "the core stays small" honest. |
| `husky` | 9.1.7 | 49.6M | 4 of 8 | Pre-commit gate. No install script, so nothing to allow in `allowBuilds`. |
| Renovate | Hosted app | n/a | 2 of 8 | One preset gives weekly PRs, SHA pinning of Actions and a 3-day age gate that matches pnpm's. |
| CodeQL default setup | Repository setting | n/a | 2 of 8 | Free for public repositories, no workflow file to maintain. |

### Kept, with evidence

| Package | Version | Evidence |
| --- | --- | --- |
| `vitest` | 5.1.0 | 6 of 8. |
| `tsdown` | 0.23.5 | 6 of 8. It stays pre-1.0, so pin it. |
| `typescript` | 7.0.2 | karakeep and papra run it. Its `tsc` is the native compiler, so no `tsgo` or `@typescript/native-preview` is needed; that package's last publish was 2026-07. |
| `electron` | 45.2.3 | cherry-studio 45.2.2, tagspaces 45.2.1. |
| `electron-builder`, `electron-updater` | 26.18.0, 6.8.11 | 4 of 4 Electron apps build with it. |
| `@electron/fuses` | 2.1.3 | 0 of 4 use it. Keep for security, and retest as open risk 8 says. |
| `vite` | 8.3.6 | cherry-studio and lobehub on 8.x. |
| Single package, no Turborepo | n/a | The monorepos have many deployables. hono, the nearest match, is close to one package. |
| `v*` tag release | n/a | Hono's flow. See Changesets below. |

### Rejected

| Tool | Survey | Why not |
| --- | --- | --- |
| `@biomejs/biome` | 0 of 8 | Replaced above. |
| `eslint` | Primary in 2 of 8, the older repos | cherry-studio still runs it after oxlint. The newer repositories have moved off it. |
| `vite-plus` 1.5.0 | 1 of 8 (hono) | One tool for lint, format, test and pack is attractive, and it wraps the same oxlint, oxfmt, vitest and tsdown. But it swaps `vite` for `@voidzero-dev/vite-plus-core`, and it pins its own tool versions. Revisit later: the configs would move across. |
| `ultracite` 8.1.1 | 1 of 8 | A preset, and vercel/ai turns off 186 rules in its own config. Our rule list is short enough to own. |
| `lefthook` 2.2.2 | 0 of 8 | Has a `postinstall` script and needs a config file. One hook line does not need it. |
| `lint-staged` 17.6.0 | 2 of 8 | oxlint and oxfmt finish in under a second on the whole repo, so filtering buys nothing. karakeep's hook also runs everything. |
| `@commitlint/cli` 21.2.4 | 1 of 8, gitmoji | Solo project, and nothing reads the commit type. |
| `@changesets/cli` 3.0.3 | 3 of 8, all multi-package | Solves version coordination, which one package does not have. `npm version minor && git push --follow-tags` starts the release, and GitHub release notes cover the changelog. Revisit if outside contributors arrive. |
| `semantic-release` 25.0.9, `release-please` 17.11.2 | 1, 0 of 8 | Same reason, and both depend on commit discipline we are not enforcing. |
| `@arethetypeswrong/cli`, `publint` 0.3.25 | 0, 2 of 8 | Check library exports. Jevonganize ships a `bin`, not an API. A packed-tarball smoke test in CI covers the real failure. |
| `depcheck`, `syncpack`, `sherif`, `dependency-cruiser`, `madge`, `dpdm` | 0 to 1 of 8 | knip covers dependencies. Version sync is a monorepo problem. oxlint covers cycles and boundaries **[tested]**. |
| `typos` 1.52, `cspell` 10.4.0 | 0 of 8 | No repository bothers. Not worth a CI step at this size. |
| zizmor, OpenSSF Scorecard | 0 of 8 | SHA pins and least-privilege `permissions` cover most of what they flag. zizmor is the first to reconsider, because the release job holds `id-token: write`. |
| `electron-vite` 6.0.0 | 1 of 4 | Exists to coordinate main, preload and renderer. We have no preload, and tsdown plus Vite already build both halves. |
| Storybook 10.6.5 | 2 of 8 | Confirmed skip. Both users have large component libraries. |
| `i18next` 26.7.2 | 5 of 6 apps | Not needed yet. Decide before the UI grows, since Japanese users are in scope (`decision-models.md`). Retrofitting strings is the expensive part, not the library. |
| Devcontainer, docs site | 1 of 8; 4 of 8 | Native OS tags cannot be tested in a Linux container. `docs/` in the repo is enough for now. |
| Codecov | 2 of 8 | A local threshold does the job with no third party. |

## Corrections to section 6

This survey touched no other file, so these are for the owner to apply.

1. **`.npmrc` no longer works for `node-linker`.** pnpm 12 ignored it **[tested]**, and lobehub's `.npmrc` says only auth and registry keys are read. Settings go in `pnpm-workspace.yaml`, which pnpm accepts with no `packages:` key **[tested]**.
2. **"electron-builder needs `node-linker=hoisted`" is not settled.** cherry-studio builds with pnpm 12 and the default linker; lobehub's desktop app uses `shamefullyHoist: true`. Try the default first. Open risk 2 stands, and this was not tested here.
3. **"Start with the `jevlint` version" of pnpm should change.** Use 12.16.1.
4. **Exact latest pins collide with the age gate.** With `minimumReleaseAge: 4320`, install refused `oxlint`, `oxfmt`, `vitest` and others published in the last 3 days **[tested]**. pnpm 12 applies a gate even with no setting, and wrote `minimumReleaseAgeExclude` entries into `pnpm-workspace.yaml` by itself **[tested]**, which explains the long lists in karakeep, cherry-studio and lobehub. Run the first install after 2026-11-09, or use versions at least 3 days old. Review that list rather than letting it grow.
5. **Release:** use `npm stage publish`, below.

## Configuration

Everything here is written for Jevonganize; none of it is copied. Lifted ideas and their licences are listed in the next section.

The `.oxlintrc.json`, `.oxfmtrc.json`, `knip.json`, `pnpm-workspace.yaml` and `renovate.json` below ran in the spike, and the planted violations were caught. Renovate passed `renovate-config-validator`.

### `package.json`

```json
{
  "packageManager": "pnpm@12.16.1",
  "scripts": {
    "lint": "oxlint --deny-warnings",
    "format": "oxfmt",
    "format:check": "oxfmt --check",
    "typecheck": "tsc --noEmit",
    "knip": "knip",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "check": "pnpm lint && pnpm format:check && pnpm typecheck && pnpm knip && pnpm test:coverage && pnpm build",
    "prepare": "husky"
  },
  "devDependencies": {
    "@playwright/test": "1.64.1",
    "@vitest/coverage-v8": "5.1.0",
    "husky": "9.1.7",
    "knip": "6.44.1",
    "oxfmt": "0.76.0",
    "oxlint": "1.91.0",
    "oxlint-tsgolint": "7.0.2005"
  }
}
```

Add the `+sha512` suffix to `packageManager` with `corepack use pnpm@12.16.1`, as cherry-studio and lobehub do **[not run]**.

### `pnpm-workspace.yaml`

```yaml
minimumReleaseAge: 4320
trustPolicy: no-downgrade
blockExoticSubdeps: true
strictDepBuilds: true
allowBuilds:
  electron: true
  esbuild: false
  sharp: false
```

`strictDepBuilds` fails the install on any package not listed, so add what it names. `trustPolicy` may need a `trustPolicyExclude` entry for packages whose publishing moved backwards; karakeep has four. The spike needed none, but it did not install the full stack. Building macOS x64 and arm64 from one runner needs a `supportedArchitectures` block; set it before the first install, because pnpm does not revisit it **[config, cherry-studio]**.

### `.oxlintrc.json`

This is also the architecture check. It enforces section 6's "`src/ai/` is the only folder that imports `ai`" and "dependencies point down". A scoped `no-restricted-imports` replaces the top-level one rather than merging, so each override repeats what it still needs.

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "unicorn", "oxc", "import", "react", "jsx-a11y", "vitest"],
  "categories": { "correctness": "error", "suspicious": "error" },
  "options": { "typeAware": true },
  "rules": {
    "import/no-cycle": "error",
    "import/no-duplicates": "error",
    "no-console": "off",
    "react/react-in-jsx-scope": "off",
    "typescript/consistent-type-imports": "error",
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/switch-exhaustiveness-check": "error",
    "unicorn/prefer-node-protocol": "error",
    "no-restricted-imports": ["error", {
      "paths": [{ "name": "electron", "message": "Only src/desktop may import electron." }],
      "patterns": [{ "group": ["ai", "@ai-sdk/*"], "message": "Only src/ai may import the AI SDK." }]
    }]
  },
  "overrides": [
    {
      "files": ["src/ai/**", "src/desktop/**", "test/**"],
      "rules": { "no-restricted-imports": "off" }
    },
    {
      "files": ["src/core/**"],
      "rules": {
        "no-restricted-imports": ["error", {
          "paths": [{ "name": "electron", "message": "Only src/desktop may import electron." }],
          "patterns": [
            { "group": ["ai", "@ai-sdk/*"], "message": "Only src/ai may import the AI SDK." },
            { "regex": "/(server|web|commands|desktop)/", "message": "core must not import upward." }
          ]
        }]
      }
    },
    {
      "files": ["src/web/**"],
      "rules": {
        "no-restricted-imports": ["error", {
          "patterns": [
            { "regex": "/(core|ai|commands|server|desktop)/", "allowTypeImports": true, "message": "web reaches the server through hono/client; type imports only." },
            { "regex": "^node:", "message": "web runs in the browser." }
          ]
        }]
      }
    }
  ]
}
```

In the spike this caught: `ai` and `electron` imported in `core`, `core` importing `server`, `web` importing `core`, `web` importing `node:fs`, a value import of `server` in `web` (while `import type { App }` passed), a cycle, a floating promise and an `<img>` with no `alt`.

`oxlint` needs a `.gitignore` present: with none, a bare `oxlint` walked `node_modules` and did not finish in 3 minutes **[tested]**. `options.typeCheck: true` (papra) reported the same two errors as `tsc` in the spike. Leave it off and keep `tsc` as the authority; dropping `tsc` is a later saving.

### `.oxfmtrc.json`

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "printWidth": 100,
  "singleQuote": true,
  "sortPackageJson": true,
  "sortTailwindcss": { "stylesheet": "src/web/tokens.css", "functions": ["cn", "cva"] },
  "ignorePatterns": ["pnpm-lock.yaml", "dist/**", "coverage/**", "docs/**/*.md"]
}
```

### `knip.json`

`src/web/components/ui` is ignored because shadcn vendors components with exports we will not all use.

```json
{
  "$schema": "https://unpkg.com/knip@6/schema.json",
  "entry": ["src/cli.ts", "src/desktop/main.ts", "src/web/main.tsx", "test/**/*.test.ts", "e2e/**/*.test.ts"],
  "project": ["src/**/*.{ts,tsx}", "test/**/*.ts", "e2e/**/*.ts"],
  "ignore": ["src/web/components/ui/**"],
  "ignoreDependencies": ["electron"],
  "ignoreExportsUsedInFile": true
}
```

### `.husky/pre-commit`

```sh
pnpm lint && pnpm format:check && pnpm typecheck
```

### `vitest.config.ts`

The threshold is a starting value. Coverage ran in the spike; 80 was not.

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/ai/**'],
      thresholds: { lines: 80 },
    },
  },
});
```

### `playwright.config.ts`

The Electron half ran **[tested]**, with `_electron.launch({ args: [...] })` and `app.firstWindow()`. The web half is **[not run]** and assumes a `--port` flag. Add `e2e` to `tsconfig.json`'s `include`. One worker follows cherry-studio, since two Electron instances would share state.

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: { trace: 'retain-on-failure' },
  webServer: { command: 'node src/cli.ts --port 4173', port: 4173 },
  projects: [
    { name: 'web', testMatch: '*.web.test.ts', use: { baseURL: 'http://127.0.0.1:4173' } },
    { name: 'electron', testMatch: '*.electron.test.ts' },
  ],
});
```

### `renovate.json`

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:best-practices", "schedule:weekly", "group:allNonMajor"],
  "timezone": "Asia/Tokyo",
  "labels": ["dependencies"]
}
```

`config:best-practices` includes `helpers:pinGitHubActionDigests` and `security:minimumReleaseAgeNpm` **[registry, Renovate source]**.

### `.github/workflows/ci.yml`

**[not run]**. The SHAs are the latest releases on 2026-11-06. All three operating systems are needed, because tag writing differs per platform. The final diff step fails if a check rewrote a tracked file.

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  check:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .node-version
      - uses: pnpm/action-setup@73e46992e05b19abd31f2f3c20e0e7370d762115 # v6.1.1
        with:
          cache: true
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: git diff --exit-code
  e2e:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .node-version
      - uses: pnpm/action-setup@73e46992e05b19abd31f2f3c20e0e7370d762115 # v6.1.1
        with:
          cache: true
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install chromium
      - run: pnpm build
      - run: pnpm test:e2e
```

### npm job in `release.yml`

**[not run]**. This replaces the plain `npm publish` step. `npm stage publish` uploads from CI with OIDC, but the version only goes public once a human approves it with 2FA. A stolen workflow can then stage a release but not ship one. `npm stage` is in npm 12.2.2 **[tested, help output]**; hono pins npm 11.17.0. Check that trusted publishing accepts a first publish, as the package may need to exist first.

```yaml
  npm:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      # checkout, setup-node with registry-url, pnpm as in ci.yml
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: npm install -g npm@12.2.2
      - run: npm stage publish --provenance --access public
```

### `electron-builder.yml` additions

**[not run]**. This answers part of open risk 8. sharp loads `detect-libc` and `semver` at runtime, so they must be unpacked with it (from cherry-studio's list). `electronLanguages` drops unused Chromium locale files.

```yaml
asarUnpack:
  - node_modules/sharp/**
  - node_modules/@img/**
  - node_modules/detect-libc/**
  - node_modules/semver/**
electronLanguages:
  - en
  - en-US
  - ja
```

## Ideas worth copying

Ideas and facts only. No source was copied, and none should be: AGPL covers karakeep, papra, cherry-studio and tagspaces, and the LobeHub Community License is not open source in the OSI sense. Reimplement from the descriptions below.

### AI tagging: karakeep (AGPL-3.0)

Read in `packages/shared/prompts.ts`, `prompts.server.ts`, `utils/tag.ts` and `apps/workers/workers/inference/tagging.ts`.

1. **Provenance per tag.** Each link records `attachedBy: ai | human`. A re-run deletes only the AI rows, in one transaction, so human tags survive. OS tags carry no provenance, so Jevonganize must hold this in SQLite. Without it, a re-run cannot tell its own tags from the user's.
2. **Prompt as a pure function.** Inputs are language, custom prompts, content, tag style, curated tags and similar tags. A separate untruncated build feeds the UI, which fits our "preview, then apply".
3. **Budget by subtraction.** Build the prompt with empty content, count its tokens, and give the content what remains of the context length. Cut by characters to a generous bound first, because tokenising is slow and blocks the event loop.
4. **Output mode as a setting**: `structured`, `json` or `plain`. Local models vary. A tolerant parse (raw JSON, then a fenced block, then the outermost braces) feeds a zod check. AI SDK's structured output covers the first mode; keep the fallback for the rest.
5. **Normalised matching.** Lower-case and strip spaces, hyphens and underscores before matching existing tags, so `machine-learning` reuses `Machine Learning`.
6. **Curated or similar.** With a curated list, the prompt restricts answers to it. Without one, tags from similar items are offered as hints, found through the job's embedding, and a failed lookup only logs an error. karakeep enforces the curated list in the prompt only; I found no check after the response. Jevonganize should check in code.
7. **An empty answer is valid.** Prompts explicitly allow no tags, and name junk not to tag (error pages, captchas, boilerplate). Our equivalent: empty, corrupt or placeholder files.
8. **Different targets per type**: 10 to 15 tags for images, 3 to 5 for text.
9. **User prompt fragments** are capped at 500 characters and have an `appliesTo` scope, with `$tags`, `$aiTags` and `$userTags` placeholders.
10. **Failure logs hold only the first 20 characters** of a bad response. That is right for private files.

Weakness: content sits in `<TEXT_CONTENT>` tags with no escaping or other injection defence. Keep the output containment from `jevlint-reference.md`, which is stricter.

### Tag storage: tagspaces (AGPL-3.0)

Read in `src/main/macUserTags.ts`, `TaggingActionsContextProvider.tsx`, `settings-default.ts` and `CLAUDE.md`.

1. **Read the xattr, not Spotlight.** `mdls` shows only indexed tags, so it returns nothing on unindexed or external volumes. `com.apple.metadata:_kMDItemUserTags` is the truth. This applies directly to us.
2. **Format.** A binary plist holding an array of strings, each `Name` or `Name\nColourIndex`. Keep the colour suffix when rewriting, or Finder colours are lost.
3. **Parser kept apart from Electron imports** so plain Node tests can run it. Same split as our `core/` and `desktop/`.
4. **tagspaces only reads Finder tags.** It stores its own in filenames (`name[tag1 tag2].ext`, the default) or in sidecars (`.ts/<filename>.json`, with `.ts/tsm.json` for folders and `.ts/tsi.json` for its index). So it is a reference for reading, not for writing OS tags.
5. **Filename tags change the file's identity.** Renames break other apps' references. OS-native tags avoid this, and it is a good reason not to offer them.
6. **Sidecars go stale.** tagspaces needs a separate cleaner for orphaned metadata. If Windows or Linux ever need a sidecar fallback, plan for this.
7. **One read-only gate.** `CommonLocation.isReadOnly` guards every write primitive. A single gate in `core/tags.ts` would give the same property for dry runs.

### Repository and process

| Idea | From | Licence | Why |
| --- | --- | --- | --- |
| Layer rules in the linter, with a message that says why | lobehub `lint.bundleBoundaries.mjs`, `oxlint.config.mts` | LobeHub Community | Done above. Turns section 6's convention into a failing check. |
| Repo-local rule as a security forcing function | vercel/ai `tools/oxlint-plugin-ai-sdk` | Apache-2.0 | oxlint `jsPlugins`. A later candidate: fail any file write outside the atomic-write helper. |
| Staged npm publish with human approval | hono `release.yml` | MIT | Adopted above. |
| `trustPolicy: no-downgrade`, `blockExoticSubdeps` | karakeep `pnpm-workspace.yaml` | AGPL-3.0 (settings only) | Adopted above. Refuses a version with weaker publish trust than its predecessors. |
| `git diff --exit-code` as the last CI step | papra `ci.yaml` | AGPL-3.0 (idea only) | Adopted above. |
| Hook runs everything, no staging filter | karakeep `.husky/pre-commit` | AGPL-3.0 (idea only) | Adopted above. |
| `AGENTS.md` with `CLAUDE.md` as a link | karakeep | AGPL-3.0 (idea only) | `jevlint` already has both files. Short (71 lines) beats long. |
| `DESIGN.md` at the root | cherry-studio, lobehub | Idea only | Section 4 of the research could become this, so agents find the tokens. |
| `architecture/` and `contributing/decisions/` | vercel/ai | Apache-2.0 | `docs/research` is half of this. Short decision records would be the other half. |
| `hardenedRuntime` only when a certificate exists | lobehub `electron-builder.mjs` | LobeHub Community (idea only) | Fits unsigned-now, signed-later. Needs a JS builder config instead of YAML, so only do it when signing arrives. |
| Version-file check, then tell the user | tagspaces, `utils-io.ts` | AGPL-3.0 (idea only) | Way around open risk 7: unsigned macOS gets a "new version" notice with no `electron-updater`. |
| Module file suffixes (`tags.repository.ts`, `tags.usecases.ts`, `tags.routes.ts`) | papra | AGPL-3.0 (idea only) | Optional. Our `core/` is too small to need it yet. |
| Model-backed lint rules | lobehub `alint` | LobeHub Community | `jevlint` already does this. Worth running it on Jevonganize. |

## Not checked

- CI YAML, the npm job, `electron-builder.yml`, the web Playwright project and `corepack use` were not run.
- Full-stack `pnpm install` with `sharp`, `electron-builder` and the rest under `strictDepBuilds` and `trustPolicy`.
- Packaging with pnpm's default linker.
- Whether oxlint's speed holds on real code. The stub project has a dozen files.
- Hono RPC under TypeScript 7 on a large route tree. Only one route was tested.
- Commit-rule cells record enforcement and `CONTRIBUTING` text only. Actual history was not sampled.
