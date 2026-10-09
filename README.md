# Daybill — exact Vercel port

Pixel- and logic-faithful port of the canonical Daybill artifact
(`invoicing-app`) to a Vercel-deployable structure. The UI (`web/App.tsx`,
`web/theme.css`, assets) is copied verbatim; the 20 backend actions are
ported verbatim to Postgres.

## Structure

- `web/` — React 19 + Tailwind 4 + Vite frontend. `App.tsx` is the exact
  artifact UI (only the two `@hatch/space-sdk/client` import lines were
  repointed at local shims). `api-client.ts` replaces the SDK action client
  with `fetch()` calls to `POST /api/<action-name>` keeping the identical
  method/argument/response interface and session handling.
- `api/` — Serverless backend. `api/[action].ts` is a single dynamic route
  serving all 20 actions (one function → stays under the Vercel Hobby
  function limit). `_defs.ts` holds the request/response zod schemas
  extracted verbatim; `_handlers.ts` holds the verbatim handler logic;
  `_schema.ts` is the 9-table schema ported to `drizzle-orm/pg-core`.
- `vercel.json` — builds `web/`, serves `web/dist`, routes `/api/*` to the
  function and everything else to the SPA.

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase Postgres connection string (Session pooler URI, `?pgbouncer=true` optional). Tables are created automatically on first request. |
| `SUPABASE_URL` | Supabase project URL (for shop-logo storage). |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-side logo uploads; never exposed to the browser). |
| `LOGO_BUCKET` | Optional. Storage bucket for logos (default `shop-logos`, created automatically as public). |

## Deploy

Push this directory to GitHub and import it in Vercel (or `vercel --prod`).
The build installs `web/` and `api/` dependencies, then runs the Vite build.
No other setup is needed — the database schema migrates itself.

## Notes / deliberate adaptations

- The artifact's `ctx.blobs` (runtime blob store) is implemented on Supabase
  Storage; `uploadLogo`/`getWorkspace` behavior is unchanged.
- `ctx.invalidateQueries()` is a server no-op: the UI already invalidates
  react-query directly on every mutation, exactly as in the artifact.
- Query retry mirrors the artifact: only network errors / 5xx retry;
  validation and auth errors surface immediately.
- The artifact's private data does NOT migrate — the Vercel deployment gets
  its own fresh database (same as the previous standalone deployment).
