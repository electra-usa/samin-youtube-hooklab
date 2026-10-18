# HookLab — notes for coding agents

- App: `app/` is Next.js 16 with breaking changes from older versions. Read `app/AGENTS.md` and the relevant page in `app/node_modules/next/dist/docs/` before using an API you're unsure of (route `params` are Promises).
- Shared core: `app/src/lib/core/` runs both inside Next and in plain Node 24 (type stripping). It must not import `server-only` or use `@/` aliases. It uses relative imports with explicit `.ts` extensions and erasable TypeScript only. The CLI (`cli/`) and the refresh worker import it directly.
- Data lives in `data/` (git-ignored): `library.db` (videos, channels, live pipeline state; schema in `core/library-schema.ts`, changes are additive) and `app.db` (chats, projects, bookmarks, settings; `app/src/lib/db/app.ts`).
- CLI commands are one file each in `cli/src/commands/`, default-exporting a `Command` (`cli/src/types.ts`).
- Public API routes live in `app/src/app/api/v1/` and use `app/src/lib/api-v1/http.ts` (`v1Handler`, optional `HOOKLAB_API_KEY`).
- Never commit secrets (`.env*`) or anything under `data/`.
- Before you finish: `cd app && npx tsc --noEmit && npx eslint src`, `app/node_modules/.bin/tsc -p cli/tsconfig.json`, and check the affected pages and endpoints in the running app.
