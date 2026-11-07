# Web demo

The real web UI on the mock's fictional files, built as a static site to show people. Nothing runs
behind it: there is no server, no key and no network call. The build sets `VITE_DEMO=1`, so every
tool that writes or calls a model, and the chat, answers "This web demo is read-only".

```sh
pnpm build:demo     # webdemo/dist
pnpm deploy:demo    # build, then `vercel deploy webdemo --prod`, serving dist as is
```
