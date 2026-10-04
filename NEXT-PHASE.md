# Next Phase — Cloud persistence (branch: `db`)

`main` stays on localDB (localStorage). All work below happens on the `db` branch only.

## Goal

- Data persists across users/devices via **Turso** on **Vercel** — all free tier.
- Auth via **Google OAuth** (free, no paid plan).
- Rule: **checklist creation requires login**. Viewing / checking off stays open.

## Free-tier budget (verified)

| Piece | Plan | Allowance |
|---|---|---|
| Vercel Hobby | $0 | 1M function calls/mo, 4 CPU-hrs |
| Turso free | $0, no card | 500M rows read / 10M written / 5GB |
| Google OAuth | free | unlimited at this scale |

## Architecture

Static frontend unchanged + thin API layer:

- `Google Identity Services` button → `id_token` (client, free)
- `POST /api/auth/google` verifies token server-side → sets `HttpOnly; Secure; SameSite=Lax` session cookie (signed JWT via `jose`, stateless = $0 DB cost)
- All Turso access lives in `/api/*` via `@libsql/client`. Token never reaches the browser.

## Schema (`db/schema.sql`)

```sql
CREATE TABLE checklists (
  id TEXT PRIMARY KEY,
  owner_sub TEXT NOT NULL,       -- Google `sub`, never email
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  data TEXT NOT NULL,            -- full list JSON (items, subs, tags)
  state TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_checklists_owner ON checklists(owner_sub);
```

One row per checklist keeps reads/writes tiny. Default: lists are **private per user**; add `visibility` column later if global sharing is wanted.

## API (Vercel Functions, Hobby free)

| File | Method | Auth | Purpose |
|---|---|---|---|
| `api/auth/google.js` | POST | no | verify `id_token` → set session cookie |
| `api/auth/me.js` | GET | cookie | current user or 401 |
| `api/auth/logout.js` | POST | cookie | clear cookie |
| `api/lists/index.js` | GET/POST | **yes** | list own / create (401 if anonymous) |
| `api/lists/[id].js` | GET/PUT/DELETE | **yes + owner check** | single-list ops (`WHERE id=? AND owner_sub=?`) |
| `api/_lib/db.js`, `api/_lib/auth.js` | — | — | Turso singleton; sign/verify sessions |

## Frontend gating (`assets/js/auth.js`, new)

- Render GIS button in sidebar/topbar; fetch `/api/auth/me` on boot.
- Gate creation entries in `assets/js/app.js` (`newListBtn → openChecklistModal("create")`, Import, Restore): anonymous users get a login-prompt modal instead.
- Anonymous fallback: Sample Checklist from localStorage keeps working.

## Migration (no data loss)

- Anonymous: localStorage as today.
- First login: one-time `POST /api/lists/migrate` uploads `checklists-v1` + `checklist-state-v1` with `owner_sub` = caller. Cloud becomes source of truth when logged in; localStorage stays as read cache.

## Env (Vercel dashboard, free)

`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GOOGLE_CLIENT_ID`, `SESSION_SECRET` (`openssl rand -base64 32`).

## Security checklist

- [ ] Turso token server-side only
- [ ] Owner check on every mutation
- [ ] Session cookie `HttpOnly; Secure; SameSite=Lax`, short expiry
- [ ] Server-side length validation on `name`/`description`; keep `esc()` rendering

## Build order

1. `git checkout -b db` → `git push -u origin db`
2. Turso DB + Google OAuth client (consoles, free) → set Vercel env vars
3. `db/schema.sql` → apply via `turso db shell`
4. `api/_lib/*` + `api/auth/*` → login/logout on Vercel preview
5. `api/lists/*` → curl-test with session cookie (401 anonymous, 200 owner)
6. `assets/js/auth.js` + gating → anonymous blocked from create, logged-in works
7. Migrate local data → verify old lists appear after login
8. Update `memory.md`/README on `db` only → push `db`, leave `main` alone
