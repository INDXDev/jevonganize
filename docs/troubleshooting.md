# Troubleshooting

Start with `jevonganize doctor`. It checks the runtime, your key, each library's volume and optional
tools.

CI runs the test suite with real tag writes on Ubuntu and Windows Server. Anything else about Linux and
Windows below comes from documentation unless noted, including Explorer, Dolphin and packaged apps.
Please report what you find.

## Tags not visible

The tags are on the file, and the app shows them. Whether your file manager does depends on the OS.

| System | Visible in the file manager? | Search |
| --- | --- | --- |
| macOS | Yes, in Finder. Reads were tested, the Finder window itself was not checked | Spotlight |
| Linux, KDE | Yes, in Dolphin. Expected, not tested | Baloo |
| Linux, GNOME | **No**. Files (Nautilus) has no user tags | The app only |
| Windows | **No**. Explorer shows nothing, on any file | The app only |

This is a limit of those systems, not a fault. Use the app or `jevonganize search`.

To confirm the tags are really there:

| System | Command |
| --- | --- |
| macOS | `mdls -name kMDItemUserTags file.pdf` |
| Linux | `getfattr -n user.xdg.tags file.pdf` (from the `attr` package) |
| Windows | `Get-Content file.pdf -Stream jevonganize.tags` in PowerShell |

Other limits:

- Colons in tags such as `doc-type:invoice` work in storage on macOS 14. How Finder's UI treats them
  is unverified. See [tags.md](tags.md).
- Tags are stored per OS. They do not sync between macOS, Linux and Windows.

## Volume unsupported

`supported()` is false, so the app offers no tag actions there, and `doctor` reports it.

| Volume | macOS | Linux | Windows |
| --- | --- | --- | --- |
| APFS, HFS+ | Yes | | |
| ext4, btrfs, XFS | | Yes | |
| NTFS, ReFS | | | Yes |
| exFAT, FAT32 | Yes, through `._` sidecar files | No | No |
| tmpfs | | Linux 6.6 or later, limited | |
| NFS | Not always kept | Only NFSv4.2, with client and server support | |
| Read-only | No | No | No |

On macOS, the `._` sidecars show up on other systems, and copying only the main file loses the tags.

Sync services differ, and none was tested. iCloud Drive reportedly keeps tags, and Dropbox lists them
as synced on macOS. Google Drive reportedly loses them. On Windows, Dropbox probably does not sync the
stream, and no source was found for OneDrive.

Move the files to a supported volume, or browse them without tags.

## Tags lost after saving

Many apps save by writing a new file and renaming it over the old one. That creates a new file, and
the tags stay behind on the old one. `sed -i` does this on macOS. How many apps do it was not measured.

The next scan sees a new inode with fewer tags, and adds a `restore` item to the review queue. It does
not restore silently, because tags on disk are the truth. Accept the item to put the tag back:

```sh
jevonganize scan
jevonganize review
```

Other operations also drop tags:

| Kept on macOS | Lost on macOS |
| --- | --- |
| `cp`, `mv`, `ditto` | `cp -X`, `cat a > b` |
| `rsync -aE` | `rsync -a` |
| `tar` between Macs | `zip` and `unzip` |
| | `git clone`, `git checkout` |
| | Node's `fs.copyFile` and `fs.cp` |

On Windows, tags survive Node's `fs.copyFile` and `fs.cp` from NTFS to NTFS (tested in CI), and an
Explorer copy is reported to keep them. They are lost by email, upload, zip, or a copy to FAT or exFAT.
Unlike on macOS, a plain save that recreates the file also loses them (tested in CI), and the next scan
adds `restore` items. See [tags.md](tags.md#lost-tags).

## Backup tools react to tagged files on Windows

Writing a stream updates a file's modified time on Windows. Jevonganize restores it exactly after each
write (tested in CI), but `ctime` still moves, and the file still raises a change event. A tool that
watches either may process the file again. No real backup tool was tried. See
[tags.md](tags.md#windows-file-times).

## Node version

```text
Jevonganize needs Node.js 24.22.1, or 26.12.1 and later. This is 22.11.0.
```

Older releases have known security holes, and Jevonganize parses hostile files, so it refuses them.
Node.js 25 is refused too. Install a current Node.js 24 or 26, and check with `node --version`. Or use the desktop app, which needs
no Node.js.

## No key

```text
There is no API key for provider "openai", so nothing was sent.
```

Store one with `jevonganize auth set openai`.

A job refuses to start with no key for the configured provider. It never falls back to another one.
This also applies to a facet's `profile` and to `[chat]`.

If you exported a key and it is not seen, environment keys are off until you run
`jevonganize auth env on`.

## Key rejected

A `401` or `403` stops the job at once, because every file would fail the same way. Cached answers
are kept.

1. Run `jevonganize auth list` to see where the key comes from.
2. If it says `env`, the environment variable wins over the stored key. Fix or unset it.
3. Store a new key with `jevonganize auth set openai`.
4. Confirm that your account can use the model. Some decision APIs are gated by account, and
   Cloudflare tokens need Workers AI permission.

## Provider limits

**Rate limits (`429`, and `529` on TypeSafe).** The SDK retries with backoff. If that runs out, the
file is marked failed and the job continues. Lower `concurrency`, then run `organize` again. Answers
already paid for are cached, so a second run resumes.

```sh
jevonganize config set concurrency 2
```

**OpenRouter `402`.** A `402` with `limit_source: openrouter_in_flight_budget` is transient. Retry.

**Limits by provider.** Checked 2026-11-06. See [providers.md](providers.md).

| Provider | Limit | Effect |
| --- | --- | --- |
| Cloudflare Clef | 64 questions and 4 images per request | Enable fewer facets, or lower `budget.images` |
| Cloudflare Clef | Long text is cut, possibly to the first 2,000 tokens or so, with no error | Unconfirmed. Answers may miss late content |
| TypeSafe | PNG and JPEG only, 280 to 1568 pixels per side. Smaller images are rejected | Images are the most likely failure |
| All | At most 255 labels and 10 levels per facet | Refused when the facet loads |

**Answers go to review, never the plan.** Chat models give no native probabilities, so
`thresholds.estimated_to_review` holds them back. See [configuration.md](configuration.md#thresholds).

**A file failed.** `jevonganize show <file>` gives the reason. Other files are unaffected.
