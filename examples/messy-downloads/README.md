# messy-downloads

A small fictional Downloads folder, **messy on purpose**. It gives Jevonganize something to tag. All
names, companies and figures are made up. Please do not send pull requests that tidy it up.

| File | What it is | Why it is here |
| --- | --- | --- |
| `invoice-44.pdf` | An unpaid invoice | The plain case. A good name and real text |
| `document(3).pdf` | A signed lease | The name says nothing, so only the text can |
| `IMG_2041.jpg` | A drawn landscape standing in for a photo | Image input, with no text |
| `Screenshot 2026-03-14 at 10.22.31.png` | A drawn order confirmation | An image with readable text |
| `bank-export-march.csv` | Bank transactions | A table, and sensitive-looking data |
| `請求書_山田商事.txt` | An invoice in Japanese | A non-English name and text |
| `meeting-notes-FINAL-final2.md` | Notes marked as a draft | The name contradicts the content |
| `re-your-order.eml` | An email | Headers and body are read as an email |
| `saved-page.html` | A saved web page with a script | Previews show the source, and the script never runs |
| `backup-old.zip` | An archive of two text files | Archives are listed and never unpacked |
| `urgent-read-me.txt` | A grocery list with a **prompt injection attempt** | See below |
| `server-backup.pem` | Not a key, despite the name | Skipped by the [built-in exclusions](../../docs/security.md#built-in-secret-exclusions) |

## Try it

Run these from the repository root. Scanning is free, needs no key, and sends nothing. Use `node
dist/cli.mjs` in place of `jevonganize` if you built from source.

```sh
jevonganize scan examples/messy-downloads
jevonganize organize examples/messy-downloads --dry-run
```

`scan` should report one file skipped: `server-backup.pem`.

`organize` without `--dry-run` sends these fictional files to your provider, and costs a little. It
writes no tags until you apply the plan. Tags land on your copy of these files, and Git does not track
them.

## The injection attempt

`urgent-read-me.txt` tells the model to call itself an invoice and to tag every other file. Closed
output limits what that can do. At worst the file mislabels itself, within the labels a facet allows.
It cannot invent a tag, touch another file, or run anything, and you see any label in the plan before
it is written. See [Prompt injection](../../docs/security.md#prompt-injection).
