# Releasing

This is the whole procedure for a release, from version bump to rollback. It is for maintainers.

The first release has not run yet. If a step differs from what you see, fix this page in the same
change as the fix.

## What a release is

A release goes to two places, and nowhere else:

| Channel | What | Made by |
| --- | --- | --- |
| npm | The `jevonganize` package, with provenance | The `npm` job, staged until a person approves it |
| GitHub Releases | One release for the tag, with the files below | The other jobs, as a draft until a person publishes it |

The GitHub Release holds:

| File | For |
| --- | --- |
| `Jevonganize-macOS-arm64.dmg` | macOS on Apple silicon |
| `Jevonganize-Windows-x64-Setup.exe` | Windows x64, an NSIS installer |
| `Jevonganize-Linux-x64.AppImage` | Linux x64 |
| `jevonganize-<version>.tgz` | The npm package, packed from the same commit |
| `SHA256SUMS.txt` | A SHA-256 checksum for every other file on the release |

The desktop file names carry no version, so the README's `releases/latest/download/` links always
reach the newest release. They are set in `electron-builder.yml` and listed in `DESKTOP` in
`scripts/release.ts`, which adds a download table for the tag to the release notes. It also uploads
`latest*.yml` and `.blockmap` files. Unsigned builds get no automatic updates, so nothing reads them
yet.

There is no Homebrew, winget, Docker or other registry. Do not add one without changing this page
first.

## One-time setup

### npm

1. Sign in to npmjs.com as an owner of `jevonganize`. Turn on two-factor authentication for the
   account.
2. In the package settings, add a trusted publisher: GitHub Actions, owner `INDXDev`, repository
   `jevonganize`, workflow `release.yml`, no environment. No npm token is stored anywhere.
3. In the package's publishing access, require two-factor authentication and disallow tokens.

npm refuses a trusted publisher for a package that does not exist yet, so the first version is
published by hand, and the `npm` job of that release fails. Download the tarball from the draft
release and publish it. Provenance only works in CI, so turn it off for this one publish:

```sh
gh release download v0.1.0 --pattern 'jevonganize-*.tgz'
npm publish jevonganize-0.1.0.tgz --access public --provenance=false
```

That one version has no provenance. Say so in its release notes. A new trusted publisher expires
unless a publish uses it within 2 days, so add it shortly before the next release:

```sh
npm trust github jevonganize --file release.yml --repository INDXDev/jevonganize --allow-stage-publish
```

### GitHub

1. Settings > Actions > General: keep the default workflow permissions read-only. Each job asks for
   the permissions it needs.
2. Add a tag ruleset for `v*` that only maintainers can bypass, so nobody else can start a release.
3. Keep private vulnerability reporting on, as [SECURITY.md](../SECURITY.md) promises.

## Try a build first

The Build workflow (`.github/workflows/build.yml`) builds the three desktop apps and the npm tarball
from any branch, and publishes nothing. Run it from the Actions tab, or:

```sh
gh workflow run build.yml --ref main
gh run download <run id>          # one folder per system
```

The files are kept for 14 days.

## Cut a release

Versions follow [Semantic Versioning](https://semver.org). Tags are `vX.Y.Z`. Pre-release tags such
as `v1.0.0-beta.1` are refused, because npm would publish them as `latest`.

1. Start from `main` with CI green. Make a branch.
2. Set the version. Skip this when `package.json` already has it, as for 0.1.0.

   ```sh
   npm version 0.2.0 --no-git-tag-version
   ```

3. In `CHANGELOG.md`, rename `## Unreleased` to the version and the date, and put an empty
   `## Unreleased` above it:

   ```md
   ## Unreleased

   ## 0.2.0 - 2026-12-01

   - What changed...
   ```

   That section becomes the release notes, so write it for people who use the app.

4. Check the tag before you push it. This prints the notes, or says what is wrong:

   ```sh
   node scripts/release.ts notes v0.2.0
   ```

5. Open a pull request, and merge it once CI passes.
6. Tag the merge commit on `main`, and push the tag:

   ```sh
   git switch main && git pull
   git tag -a v0.2.0 -m v0.2.0
   git push origin v0.2.0
   ```

The tag starts `.github/workflows/release.yml`.

## What CI does

| Job | Runs on | Does |
| --- | --- | --- |
| `verify` | Ubuntu | Fails unless the tag is `v` plus the `package.json` version and `CHANGELOG.md` has that section. Then creates the draft release with that section as its notes |
| `desktop` | macOS, Ubuntu, Windows | `pnpm check`, then electron-builder uploads that platform's build to the draft |
| `tarball` | Ubuntu | Builds, checks the tarball's file list, and uploads `pnpm pack` output to the draft |
| `checksums` | Ubuntu | After `desktop` and `tarball`, downloads every file on the draft and uploads `SHA256SUMS.txt` |
| `npm` | Ubuntu | `pnpm check`, checks the file list, then `npm stage publish --provenance` |

Every job waits for `verify`, so a wrong tag publishes nothing. Release jobs use no dependency cache,
and actions are pinned by SHA. The `npm` job can only stage: the package goes public when a person
approves it with 2FA, so a stolen workflow cannot ship a release on its own.

A failed job can be run again. The draft is created once, and uploads replace files of the same name.

## Approve the npm publish

1. Wait for the `npm` job to pass.
2. On npmjs.com, open the staged version of `jevonganize`. Check the version, the file list and the
   provenance, which must point at `release.yml` on the tag's commit.
3. Approve it with your second factor.

Do this before you publish the GitHub Release, so its install line works when people read it.

## Publish the GitHub Release

1. Wait for every job, including `checksums`. Open the draft under Releases.
2. Check that all five kinds of file are there, and that the notes match the CHANGELOG.
3. Download the build for your own system and check it against `SHA256SUMS.txt`:

   ```sh
   shasum -a 256 -c SHA256SUMS.txt --ignore-missing
   ```

4. Start it once. On macOS, allow it in System Settings > Privacy & Security first.
5. Press Publish release.

The Windows and Linux builds have not been tried by hand. Say so in the notes until someone has.

## Verify

```sh
npm view jevonganize@0.2.0 version dist.tarball
npx jevonganize@0.2.0 --version
```

To check provenance, install it in an empty folder and run `npm audit signatures`. npm prints how many
packages have verified attestations, and `jevonganize` must be one of them. The package page on
npmjs.com also shows the provenance, linked to the workflow run.

## Roll back

Never unpublish from npm. A version number, once published, is never reused.

| Problem | Do |
| --- | --- |
| `verify` failed | Nothing was published. Delete the tag with `git push --delete origin v0.2.0`, fix the problem, and tag again |
| A job failed after `verify` | Run it again. Or delete the draft and the tag, fix, and start over with the same version |
| A staged npm version is wrong | Do not approve it. Discard it on npmjs.com |
| A published npm version is broken | `npm deprecate jevonganize@0.2.0 "Broken: use 0.2.1"`, then release a patch |
| The draft is wrong | Delete it with `gh release delete v0.2.0`. If nothing reached npm, delete the tag too |
| A published GitHub Release is broken | Edit its notes to say so and point to the fix. Release a patch |

## Signing

Desktop builds are unsigned until a signing identity exists. macOS builds get an ad-hoc signature, so
Apple silicon can run them, and that says nothing about who built them. Users must allow the app in
System Settings > Privacy & Security, and Windows shows a SmartScreen warning. Unsigned builds get no
automatic updates. See [security.md](security.md#electron).
