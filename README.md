# Checklists

A fast, local-first checklist app for anything — groceries, trips, projects,
releases. Create **multiple checklists**, nest **subtasks**, add
**descriptions**, track progress with **analytics**, and export any checklist
as a **standalone HTML file** that works offline anywhere.

No account. No build step. Everything lives in your browser.

## Quick start

```bash
# option 1 — zero dependencies (Python 3, stdlib only)
python3 server.py            # → http://localhost:8131
python3 server.py 8080      # custom port
HOST=0.0.0.0 PORT=8080 python3 server.py   # listen on all interfaces

# option 2 — just open it (persistence still works via localStorage)
open index.html

# option 3 — docker
docker build -t checklists .
docker run --rm -p 8080:8080 checklists   # → http://localhost:8080
```

## Features

- **Multiple checklists** — create, rename (with description), delete, switch
  from the sidebar or the switcher bar; import a `.txt` file as a new list
  (indented lines become subtasks)
- **Subtasks** — nest tasks, collapse/expand groups (state persists),
  parent auto-completes when all subtasks are done, toggling a parent cascades
- **Descriptions** — on checklists, items, and subtasks
- **Progress & analytics** — KPIs, progress ring, completion donut,
  per-checklist bars, last-7-days activity chart
- **Activity log** — last 50 events, paginated, with per-page selector
- **Views** — Overview, Checklist (search, filter, 6 sort orders, density,
  pagination), Activity, Settings (theme, defaults, storage usage)
- **Exports per checklist**
  - `name-YYYY-MM-DD.html` — fully standalone page (inline CSS/JS/data, no
    sidebar, works from `file://`, own localStorage progress)
  - `name-YYYY-MM-DD.txt` — `todo_checklist`-compatible lines
  - Copy to clipboard
- **Dark mode by default** (light available), self-hosted Inter/JetBrains Mono
  fonts, Lucide icons vendored — zero runtime network calls

## Project structure

```
index.html            # app shell (sidebar, topbar, views, modals)
server.py             # static server, stdlib only (HOST/PORT env supported)
assets/css/           # tokens, base, layout, components (loaded via main.css)
assets/js/            # config, store (data layer), export-html (standalone
                      #   builder), app (UI); vendor/lucide.min.js
assets/icons/lucide/  # static copies of icons used
assets/fonts/         # self-hosted woff2 + @font-face sheet
assets/data/          # sample seed data (reference only, replaceable)
memory.md             # contributor context — start here when developing
```

## Data & privacy

100% local-first. Nothing leaves your browser. Storage keys (all JSON):

| Key | Contents |
|---|---|
| `checklists-v1` | lists, items, subtasks, descriptions |
| `checklist-state-v1` | completion flags keyed by stable ids |
| `active-checklist-id` | selected list |
| `checklist-activity-v1` | last 50 events |
| `checklist-theme/density/sort/page-size` | UI prefs |
| `checklist-activity-page-size` | activity pager size (default 8) |
| `checklist-sidebar`, `checklist-collapsed-v1` | sidebar + collapsed groups |

First run seeds one editable **Sample Checklist** (from `assets/data/…`).
Reset everything from Settings → Data & storage, or clear site data in the
browser.

## Development

No build, no tests framework. Conventions: plain scripts (keep `file://`
working), `esc()` all user text into HTML, Lucide via `data-lucide` +
`refreshIcons()` after renders. A fake-DOM harness
(`/tmp/checklist-test.js`, ~84 checks) boots the real app — run
`node /tmp/checklist-test.js`; see `memory.md` before changing architecture.
