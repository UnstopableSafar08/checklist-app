# memory.md — project memory for the checklist web app

> Read this first when continuing work. Updated 2026-10-03 (v2.2.0). The `checklist-items.txt`
> sample data is REFERENCE ONLY — the app is a generic checklist tool, keep all
> copy/domain language generic (items, not endpoints; no infra specifics).

## 1. What this is

A local-first, multi-checklist web app with subtasks, descriptions, progress
tracking, analytics, activity log, per-checklist **standalone HTML export**
(self-contained files with zero dependencies), full **JSON backup/restore**,
and **CSV/TXT task import**. Dark enterprise-style UI.

## 2. Stack & hard constraints

- **Vanilla HTML/CSS/JS only. No build step, no bundler, no framework.**
- Scripts are plain `<script src>` (NOT ES modules) so the app also works from
  `file://`. Keep it that way.
- Icons: vendored Lucide via `assets/js/vendor/lucide.min.js` + `data-lucide`
  attributes + `refreshIcons()` after every render. Static SVG copies live in
  `assets/icons/lucide/`. Icon names in the bundle are PascalCase
  (`ChartPie`); `data-lucide` uses kebab-case (`chart-pie`) — verified present.
- Fonts: self-hosted Inter + JetBrains Mono woff2 in `assets/fonts/`.
  No CDN calls at runtime, ever (standalone exports must also be offline-clean).
- `server.py` is stdlib-only (`HOST`/`PORT` env supported, defaults
  `127.0.0.1:8131`). Dockerfile serves the same static files on `:8080`.
- **Always escape user text with `esc()`** before injecting into HTML
  (XSS-sensitive: titles/descriptions end up in exports too).

## 3. Layout

```
index.html                  # shell: sidebar, topbar, views, modals, toasts
server.py                   # static dev server (stdlib only)
Dockerfile / .dockerignore / .gitignore
assets/css/  tokens.css base.css layout.css components.css (via main.css)
assets/js/   config.js store.js export-html.js app.js
assets/js/vendor/lucide.min.js
assets/icons/lucide/*.svg  # static copies of icons actually used
assets/fonts/  fonts.css + inter/*.woff2
assets/data/   checklist-items.txt + todo-checklist-seed.json (SAMPLE data)
               + sample-tasks.csv / sample-tasks.txt (import format samples,
                 linked from both import UIs, downloadable offline)
```

Views (hash-routed `#/overview|checklist|activity|settings`): Overview
(KPIs + progress + analytics + recent), Checklist (switcher + panel +
pagination), Activity (paginated log), Settings. View subtitles share one
muted label style (`.page-head .sub.as-label`, permanent class).
WORKSPACE nav holds only Overview + Activity — the separate "Checklist" nav
item was removed as redundant (every list button opens that view); do NOT
re-add without asking. Overview nav + brand logo both reload to root
(`goRoot()`). Topbar holds only search, hamburger (drawer opener, ≤900px),
theme, bell, avatar — no other crumbs/page-actions without asking.
Modals (all: pinned header/footer, scrolling `.modal-body`): add/edit task
("Add Task", never "Add item"), subtask creator, checklist create/rename,
Import Data (drag&drop/browse), restore-backup confirm, delete, shortcuts.

## 4. Data model (localStorage, all JSON unless noted)

| Key | Value |
|---|---|
| `checklists-v1` | `[{id, name, description, createdAt, updatedAt, items: [{id, title, description, tags, createdAt, subs: [{id, title, description, tags, createdAt}]}]}]` (`tags`: lowercase `string[]`, max 12, each ≤30 chars). Sidebar paginates checklists at 6/page (`SIDE_PAGE_SIZE`, `state.sidePage`, pager follows the active list only when it changes); `.nav` scrolls internally so footer + collapse toggle stay pinned. |
| `checklist-state-v1` | `{[listId]: {[itemId\|subId]: true}}` (stable ids → renames never lose progress) |
| `active-checklist-id` | plain string |
| `checklist-activity-v1` | last 50 `{t, kind, text, list?}` (`verify\|reopen\|bulk\|add\|edit\|remove`) |
| `checklist-theme` | `light\|dark` (default `dark`) |
| `checklist-density` / `checklist-sort` / `checklist-page-size` | UI prefs (sort default `newest`, page default `10`, `0` = All) |
| `checklist-activity-page-size` | activity pager (default `8`, `0` = All) |
| `checklist-sidebar-v2` | `1\|0` icon-rail collapse (absent = expanded; v1 `checklist-sidebar` key retired & cleaned on boot) |
| `checklist-collapsed-v1` | `[itemId]` collapsed subtask groups |
| Legacy (read once on migrate, never deleted): `checklist-status-v1`, `checklist-custom-v1` | |

Core rules: sort default **newest→oldest by `createdAt`**; every parent and
subtask checkbox is **fully independent** (v2.1.0: `effDone()` = own flag
only, no cascade — toggling happens only via checkbox `change` or the
title label, never via row-background clicks); subtask progress shows as an
`x/y subs` chip; progress counts every row (items + subs); checklist
pagination counts top-level items; activity log paginates separately;
standalone export = whole list in current sort order. `.txt` export format
stays `YYYY-MM-DD - [Completed|Active] - title` (subtasks indented `  └ `)
for `todo_checklist` compat, with ` #tag` suffixes when tags exist.
Descriptions render ` ```lang ``` ` fenced blocks with dependency-free
per-language highlighting (`highlightCode`, exposed as
`window.ChecklistHighlight` for the exporter) + `` `inline` `` code; no
"click to expand" hint on rows (modal hint only). Tags are comma-separated
in the add/edit modal (incl. per-subtask fields in the multi-subtask
creator), shown as plain `#tag` labels inline on the same line as the title
(`.title-row`; deliberately NOT clickable — tag-click-to-filter was removed
by request; search still matches tag text). Import parses trailing ` #tag`
tokens.
Forms validate inline (`.field-error` + red border via `setFieldError()`,
required `*` markers, live-clear on typing): task title, subtask presence
when "has subtask(s)" is checked, checklist name. Duplicates still toast.
Import UIs accept `.txt`/`.csv` only: (a) task import inside the Add Task
modal (TXT lines w/ indent-subs, or CSV `title,tags,description` with
optional header, `;`/`|` tag separators, dup-skip, 500 cap, `addImportedGroups()`);
(b) Import Data modal (toolbar) with drag&drop/browse, live summary,
destination New/Active checklist, and empty-file validation
(`setImportError()` + dropzone `attn` nudge — confirm stays clickable so the
message can show). Sample files linked in both modals.
Settings backs up ALL localStorage keys to `checklist-backup-*.json`
(`doBackup()`) and restores from file with shape validation + confirm modal
+ `location.reload()` (`confirmRestore`).

## 5. Test practice (helpers live in /tmp, NOT in repo)

No committed suite. Verification is ad-hoc per change, typically:
- `node --check assets/js/*.js` + CSS brace-balance checks.
- `node /tmp/t_*.js`: vm-extracted real functions (parsers, highlighters,
  import/store logic) with stubbed DOM, asserting behavior incl. edge cases
  (quoted CSV commas/CRLF/BOM, escaped code quotes, invalid backups).
- Headless Chrome (`--dump-dom`, screenshots, `--enable-logging` for JS
  errors) served via `python3 -m http.server`, incl. seeded-localStorage
  preset pages and (when needed) a minimal no-deps CDP client for clicks.
  Note: old-headless `--screenshot` can freeze mid-animation and mislead —
  prefer CDP `Page.captureScreenshot` or `--force-prefers-reduced-motion`.
  Known quirk: fresh profiles have empty storage (defaults apply).

## 6. Known issues / decisions to remember

- Sidebar defaults to **expanded** on desktop (laptop/monitors); only phones
  (≤900px) start with the navigation hidden in the hamburger drawer
  (`body.nav-open` opens it; closes on nav select, scrim click, or Esc).
  Collapse choice persists per browser under `checklist-sidebar-v2`.
  Collapsed rail keeps icon buttons + count badges + new-list `+` with
  `title` tooltips and a smooth `grid-template-columns` transition.
- Boot shows a loader overlay (`#boot`, removed after first render), then
  skeleton shimmer veils (`body.is-booting` ::after over KPIs/analytics/
  checklist/progress, min 600ms display) before reveal with KPI count-up
  once (`state.bootAnim`), analytics donut fill (`.donut-fg` transition from
  empty), checklist row stagger (`#checklist.enter-rows`, boot only), and a
  staggered `rise` entrance per view (`playEntrance()`); all disabled under
  `prefers-reduced-motion`.
- Logo click and the Overview nav item both reload the page to root
  (`goRoot()` → `#/overview` + `location.reload()`); other nav items switch
  views in place. Brand is keyboard-accessible (`role=button`, tabindex).
- Buttons: `.btn.primary` has an animated gradient background; every button
  (incl. icon/mini/pager/code-copy) gets a hover light-sweep (`btnSheen`);
  all disabled under `prefers-reduced-motion`. The toolbar "+ Add" is
  primary, same as Export HTML.
- All modals are flex-column with capped height: fixed header, scrolling
  `.modal-body`, pinned footer — long subtask/import forms can't push
  actions off-screen.
- Hash route `#/endpoints`, internal `renderEndpoints` name, `verify`/`reopen`
  activity kinds, and `navPending`-era ids were removed; `#/endpoints` now
  safely falls back to overview.
- Standalone exports (`ChecklistExport.build`) deliberately omit sidebar,
  views, and multi-list UI; new items added inside them are title-only.
- Sample seed (`FALLBACK_ITEMS` + both `checklist-items.txt` copies +
  `todo-checklist-seed.json` + `import-via-console.js`) must stay in sync
  and generic (currently 12 neutral tasks).

## 7. Backlog (not started)

- Due dates/reminders, drag-to-reorder, list sharing beyond file export,
  print stylesheet pass, PWA manifest/offline install.
