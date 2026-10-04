/* Checklist Ops Console — application controller. */
(function () {
  "use strict";
  const C = window.ChecklistConfig;
  const Store = window.ChecklistStore;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  const state = {
    lists: [], // [{id, name, createdAt, updatedAt, items: [{id, title, createdAt}]}]
    listState: {}, // {[listId]: {[itemId]: true}}
    activeId: null,
    filter: "all",
    query: "",
    sort: Store.getSort(),
    density: Store.getDensity(),
    page: 1,
    pageSize: Store.getPageSize(),
    apage: 1,
    apageSize: Store.getActPageSize(),
    view: "overview",
    collapsed: new Set(Store.getCollapsedIds()),
    bootAnim: false, // true only for the single render that plays KPI count-up
    sidePage: 1, // sidebar checklist pagination
    sidePageFor: null, // activeId the sidePage was last synced to
  };

  // ---------- multi-checklist model ----------
  function activeList() {
    return state.lists.find((l) => l.id === state.activeId) || state.lists[0] || null;
  }
  function setActive(id) {
    if (!state.lists.some((l) => l.id === id)) return;
    state.activeId = id;
    Store.setActiveId(id);
    state.page = 1;
  }
  function saveAll() {
    Store.saveLists(state.lists);
    Store.saveListState(state.listState);
  }
  function touchActive() {
    const l = activeList();
    if (l) l.updatedAt = Date.now();
  }
  function itemById(id) {
    const l = activeList();
    return l ? l.items.find((it) => it.id === id) || null : null;
  }
  function listDoneCount(list) {
    const m = state.listState[list.id] || {};
    // Independent parents: only the parent's own flag counts here.
    return (list.items || []).filter((it) => !!m[it.id]).length;
  }

  // ---------- views ----------
  const VIEWS = ["overview", "checklist", "activity", "settings"];
  const VIEW_META = {
    overview: { title: "Checklists overview", sub: "All your lists at a glance. Create a checklist for anything, track progress, and share any list as a standalone page." },
    checklist: { title: "Checklist", sub: "Add items, check them off, and export anytime — progress stays in this browser." },
    activity: { title: "Activity log", sub: "What changed and when — the last 50 events in this browser." },
    settings: { title: "Settings", sub: "Preferences and local data controls. Everything stays in this browser." },
  };
  function viewFromHash() {
    const h = (location.hash || "").replace(/^#\/?/, "").split("?")[0];
    return VIEWS.includes(h) ? h : "overview";
  }
  function setView(name, opts) {
    if (!VIEWS.includes(name)) name = "overview";
    state.view = name;
    if (name === "activity") state.apage = 1;
    VIEWS.forEach((v) => {
      const sec = document.getElementById("view-" + v);
      if (sec) sec.classList.toggle("hidden", v !== name);
    });
    $$(".nav-item[data-view]").forEach((n) => n.classList.toggle("active", n.dataset.view === name));
    const meta = VIEW_META[name];
    const title = document.getElementById("viewTitle");
    if (title) title.textContent = meta.title;
    const sub = document.getElementById("viewSub");
    if (sub) sub.innerHTML = esc(meta.sub);
    if (!opts || opts.hash !== false) {
      const want = "#/" + name;
      if (location.hash !== want) location.hash = want;
    }
    document.body.classList.remove("nav-open");
    render();
    // Instant nav switches: local data is sync, so never show skeleton /
    // entrance here. Skeleton veils appear only on slow async loads (boot),
    // and the entrance animation plays once on boot.
    if (!opts || opts.scroll !== false) window.scrollTo(0, 0);
    refreshIcons(document);
  }

  // ---------- helpers ----------
  function shortName(title) {
    const parts = title.split(" - ");
    return parts[0].trim();
  }
  function truncTitle(title) {
    const t = String(title ?? "");
    return t.length > 60 ? `${t.slice(0, 60)} ...` : t;
  }
  // Rows of the ACTIVE checklist. createdAt drives newest→oldest ordering.
  // Each row may carry nested subtasks: {id, title, createdAt, subs: []}.
  // Tags ride along on both levels: {tags: ["bug", "urgent"]}.
  function allItems() {
    const l = activeList();
    if (!l) return [];
    const tagsOf = (x) => (Array.isArray(x.tags) ? x.tags.filter((t) => typeof t === "string" && t) : []);
    return l.items.map((it) => ({
      id: it.id,
      title: it.title,
      description: it.description || "",
      createdAt: it.createdAt,
      tags: tagsOf(it),
      subs: Array.isArray(it.subs) ? it.subs.map((s) => ({ id: s.id, title: s.title, description: s.description || "", createdAt: s.createdAt, tags: tagsOf(s) })) : [],
    }));
  }
  function isDone(id) {
    const l = activeList();
    return !!(l && (state.listState[l.id] || {})[id]);
  }
  // Parent tasks are INDEPENDENT: a parent is done only when its own
  // checkbox is checked. Checking a subtask never auto-checks the parent.
  // Subtask progress is shown separately via the "x/y subs" chip.
  function effDone(r) {
    return isDone(r.id);
  }
  function setDone(id, val) {
    const l = activeList();
    if (!l) return;
    if (!state.listState[l.id]) state.listState[l.id] = {};
    if (val) state.listState[l.id][id] = true;
    else delete state.listState[l.id][id];
  }
  // Rich text: escape HTML, then render ```lang … ``` fenced blocks and
  // `inline` snippets. Used for item / subtask descriptions + live preview.
  function inlineRich(t) {
    let e = esc(t);
    e = e.replace(/`([^`\n]+)`/g, '<code class="icode">$1</code>');
    e = e.replace(/\n/g, "<br>");
    return e;
  }
  // ---------- dependency-free code highlighting ----------
  // Colors: keywords (tok-k), strings (tok-s), comments (tok-c),
  // numbers (tok-n), function calls / tag attrs (tok-f). No libraries,
  // works from file:// and inside exported standalone pages.
  const HL_WORDS = {
    js: "await async break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return static super switch this throw try typeof var void while with yield of from as get set null undefined true false NaN Infinity",
    ts: "await async break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return static super switch this throw try typeof var void while with yield of from as get set interface type enum implements private public protected readonly abstract namespace declare module null undefined true false",
    py: "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False self",
    sh: "if then elif else fi for while until do done case esac function select in time coproc export readonly local declare typeset echo printf cd exit return shift source alias unalias test sudo",
    sql: "select from where group by order having limit offset join left right full inner outer cross on as and or not null in is like ilike between exists union all distinct insert into values update set delete create table alter drop index view primary key foreign references default check unique constraint having into",
    json: "true false null",
    css: "color background border margin padding display flex grid position top left right bottom width height font size weight family style text align justify content items self overflow opacity transform transition animation shadow radius cursor import media charset supports keyframes face page layer container block inline none relative absolute fixed sticky",
    yaml: "true false null yes no on off",
  };
  const HL_ALIAS = {
    javascript: "js", jsx: "js", typescript: "ts", tsx: "ts", java: "js", c: "js", h: "js",
    cpp: "js", hpp: "js", cs: "js", csharp: "js", go: "js", rust: "js", php: "js",
    swift: "js", kotlin: "js", dart: "js", python: "py", bash: "sh", shell: "sh",
    zsh: "sh", console: "sh", terminal: "sh", dockerfile: "sh", yml: "yaml",
    toml: "yaml", ini: "yaml", rb: "py", ruby: "py", lua: "sql",
  };
  const HL_SETS = {};
  Object.keys(HL_WORDS).forEach((k) => { HL_SETS[k] = new Set(HL_WORDS[k].split(" ")); });
  HL_SETS.__generic = HL_SETS.js;
  const HL_RE_CACHE = {};
  function hlKey(lang) {
    const l = String(lang || "").toLowerCase();
    if (HL_SETS[l]) return l;
    if (HL_ALIAS[l] && HL_SETS[HL_ALIAS[l]]) return HL_ALIAS[l];
    return "__generic";
  }
  function hlRegex(key) {
    if (HL_RE_CACHE[key]) return HL_RE_CACHE[key];
    const DQ = "\"(?:[^\"\\\\\\n]|\\\\.)*\"";
    const SQ = "'(?:[^'\\\\\\n]|\\\\.)*'";
    const BT = "`(?:[^`\\\\]|\\\\.)*`";
    let comment, str;
    if (key === "py") {
      comment = "#[^\\n]*";
      str = "\"\"\"[\\s\\S]*?\"\"\"|'''[\\s\\S]*?'''|" + DQ + "|" + SQ;
    } else if (key === "yaml" || key === "sh") {
      comment = "#[^\\n]*";
      str = DQ + "|" + SQ + "|" + BT;
    } else if (key === "sql") {
      comment = "\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*|\\-\\-[^\\n]*|#[^\\n]*";
      str = DQ + "|" + SQ + "|" + BT;
    } else {
      comment = "\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*";
      str = DQ + "|" + SQ + "|" + BT;
    }
    const re = new RegExp("(" + comment + ")|(" + str + ")|\\b(\\d+(?:\\.\\d+)?)\\b|([A-Za-z_$][\\w$]*)", "g");
    HL_RE_CACHE[key] = re;
    return re;
  }
  function hlTag(tag) {
    const m = tag.match(/^<(\/?)([A-Za-z][\w:.-]*)([\s\S]*?)(\/?)>$/);
    if (!m) return esc(tag);
    let h = esc("<" + m[1]) + `<span class="tok-k">${esc(m[2])}</span>`;
    const rest = m[3] || "";
    const are = /([\w:.-]+)(\s*=\s*("[^"]*"|'[^']*'))?/g;
    let l = 0, am;
    while ((am = are.exec(rest))) {
      h += esc(rest.slice(l, am.index));
      h += `<span class="tok-f">${esc(am[1])}</span>`;
      if (am[2]) {
        const vm = am[2].match(/^(\s*=\s*)([\s\S]*)$/);
        if (vm) h += esc(vm[1]) + `<span class="tok-s">${esc(vm[2])}</span>`;
        else h += esc(am[2]);
      }
      l = am.index + am[0].length;
    }
    h += esc(rest.slice(l)) + esc(m[4] + ">");
    return h;
  }
  function hlHTML(raw) {
    const re = /(<!--[\s\S]*?-->)|(<\/?[A-Za-z][^<>]*\/?>)/g;
    let out = "", last = 0, m;
    while ((m = re.exec(raw))) {
      out += esc(raw.slice(last, m.index));
      out += m[1] ? `<span class="tok-c">${esc(m[1])}</span>` : hlTag(m[2]);
      last = m.index + m[0].length;
    }
    out += esc(raw.slice(last));
    return out;
  }
  function highlightCode(raw, lang) {
    const code = String(raw || "");
    if (!code) return "";
    const L = String(lang || "").toLowerCase();
    if (L === "html" || L === "xml" || L === "svg") return hlHTML(code);
    const key = hlKey(L);
    const kw = HL_SETS[key] || HL_SETS.__generic;
    const re = hlRegex(key);
    re.lastIndex = 0;
    let out = "", last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      if (m[1] !== undefined) {
        out += `<span class="tok-c">${esc(m[1])}</span>`;
      } else if (m[2] !== undefined) {
        out += `<span class="tok-s">${esc(m[2])}</span>`;
      } else if (m[3] !== undefined) {
        out += `<span class="tok-n">${esc(m[3])}</span>`;
      } else if (m[4] !== undefined) {
        const w = m[4];
        if (kw.has(w)) out += `<span class="tok-k">${esc(w)}</span>`;
        else if (/^\s*\(/.test(code.slice(re.lastIndex, re.lastIndex + 8))) out += `<span class="tok-f">${esc(w)}</span>`;
        else out += esc(w);
      }
      last = m.index + m[0].length;
    }
    out += esc(code.slice(last));
    return out;
  }
  // Exposed for the standalone-HTML exporter (same highlighting at export time).
  try { window.ChecklistHighlight = highlightCode; } catch {}
  function renderRich(raw) {
    const text = String(raw || "");
    if (!text) return "";
    const re = /```(\w*)\n?([\s\S]*?)(?:```|$)/g;
    let last = 0, m, has = false;
    let html = "";
    while ((m = re.exec(text))) {
      has = true;
      html += inlineRich(text.slice(last, m.index));
      const lang = (m[1] || "code").slice(0, 20);
      const code = String(m[2] || "").replace(/\n$/, "");
      html += `<pre class="codeblock"><div class="codehead"><span class="lang">${esc(lang)}</span><button class="codecopy" data-act="codecopy" type="button" title="Copy code">Copy</button></div><code>${highlightCode(code, lang)}</code></pre>`;
      last = m.index + m[0].length;
    }
    html += inlineRich(text.slice(last));
    return has ? html : inlineRich(text);
  }
  function allRows() {
    const out = [];
    allItems().forEach((r) => {
      out.push(r);
      (r.subs || []).forEach((s) => out.push({ ...s, parentId: r.id }));
    });
    return out;
  }
  function slug(s) {
    const out = String(s || "checklist").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return out || "checklist";
  }
  function todayStr() {
    return new Date().toISOString().split("T")[0];
  }
  function tagSuffix(tags) {
    const list = Array.isArray(tags) ? tags.filter((t) => typeof t === "string" && t) : [];
    return list.length ? " #" + list.join(" #") : "";
  }
  function toExportTxt(rows) {
    const date = todayStr();
    const out = [];
    rows.forEach((r) => {
      out.push(`${date} - [${effDone(r) ? "Completed" : "Active"}] - ${r.title}${tagSuffix(r.tags)}`);
      (r.shownSubs || r.subs || []).forEach((s) => {
        out.push(`${date} - [${isDone(s.id) ? "Completed" : "Active"}] -   └ ${s.title}${tagSuffix(s.tags)}`);
      });
    });
    return out.join("\n");
  }
  function download(filename, text, mime = "text/plain") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 800);
  }

  // ---------- icons ----------
  function refreshIcons(root = document) {
    try {
      if (window.lucide && typeof window.lucide.createIcons === "function") {
        window.lucide.createIcons({ attrs: { "stroke-width": 2 }, nameAttr: "data-lucide" });
      }
    } catch {}
    // Ensure dynamically-added <i data-lucide> get sized even if lucide failed:
    $$("i[data-lucide]", root).forEach((el) => {
      if (!el.firstChild) el.setAttribute("aria-hidden", "true");
    });
  }

  // ---------- toast ----------
  function toast(kind, title, msg) {
    const box = $("#toasts");
    if (!box) return alert(title);
    const el = document.createElement("div");
    el.className = `toast ${kind || "info"}`;
    el.setAttribute("role", "status");
    const icon = kind === "success" ? "circle-check" : kind === "warn" ? "triangle-alert" : "info";
    el.innerHTML = `<i data-lucide="${icon}"></i><div><b>${esc(title)}</b>${msg ? `<span>${esc(msg)}</span>` : ""}</div>`;
    box.appendChild(el);
    refreshIcons(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 280);
    }, 3200);
  }

  // ---------- filtering / sorting ----------
  function sortRows(rows) {
    const checkedFirst = (a, b) => Number(effDone(b)) - Number(effDone(a));
    switch (state.sort) {
      case "oldest": return [...rows].sort((a, b) => a.createdAt - b.createdAt);
      case "az": return [...rows].sort((a, b) => a.title.localeCompare(b.title));
      case "za": return [...rows].sort((a, b) => b.title.localeCompare(a.title));
      case "done": return [...rows].sort(checkedFirst);
      case "pending": return [...rows].sort((a, b) => -checkedFirst(a, b));
      case "newest":
      default: return [...rows].sort((a, b) => b.createdAt - a.createdAt); // newer → older
    }
  }
  function rowMatches(r, q) {
    if (!q) return true;
    if (r.title.toLowerCase().indexOf(q) !== -1) return true;
    return (r.tags || []).some((t) => String(t).toLowerCase().indexOf(q) !== -1);
  }
  function subVisible(s, q, filter) {
    const d = isDone(s.id);
    if (filter === "active" && d) return false;
    if (filter === "completed" && !d) return false;
    if (q && !rowMatches(s, q)) return false;
    return true;
  }
  function visibleItems() {
    const q = state.query.trim().toLowerCase();
    let rows = allItems().map((r) => ({ ...r, shownSubs: sortRows((r.subs || []).filter((s) => subVisible(s, q, state.filter))) }));
    rows = rows.filter((r) => {
      const d = effDone(r);
      const selfOk = (state.filter === "all" || (state.filter === "active" ? !d : d)) && rowMatches(r, q);
      return selfOk || r.shownSubs.length > 0;
    });
    return sortRows(rows);
  }

  // ---------- pagination ----------
  function totalPagesFor(count) {
    if (state.pageSize <= 0) return 1; // "All" → single page
    return Math.max(1, Math.ceil(count / state.pageSize));
  }
  function clampPage(count) {
    const total = totalPagesFor(count);
    if (state.page < 1) state.page = 1;
    if (state.page > total) state.page = total;
  }
  function currentSlice(rows) {
    if (state.pageSize <= 0) return { slice: rows, start: 0 };
    const start = (state.page - 1) * state.pageSize;
    return { slice: rows.slice(start, start + state.pageSize), start };
  }
  function gotoPage(n, scroll) {
    state.page = n;
    clampPage(visibleItems().length);
    render();
    if (scroll) {
      const list = document.getElementById("checklist");
      if (list) list.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  function pageWindow(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const set = new Set([1, 2, current - 1, current, current + 1, total - 1, total]);
    const nums = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
    const out = [];
    let prev = 0;
    for (const n of nums) {
      if (n - prev > 1) out.push("…");
      out.push(n);
      prev = n;
    }
    return out;
  }
  function renderPagination(filteredCount) {
    const pag = $("#pagination");
    if (!pag) return;
    const total = totalPagesFor(filteredCount);
    clampPage(filteredCount);
    const showAll = state.pageSize <= 0;
    const start = filteredCount === 0 ? 0 : showAll ? 1 : (state.page - 1) * state.pageSize + 1;
    const end = showAll ? filteredCount : Math.min(filteredCount, state.page * state.pageSize);
    const info = $("#pageInfo");
    if (info) info.textContent = filteredCount === 0 ? "No items" : `Showing ${start}–${end} of ${filteredCount}`;
    const prev = $("#prevPage");
    const next = $("#nextPage");
    if (prev) prev.disabled = state.page <= 1;
    if (next) next.disabled = state.page >= total;
    const nums = $("#pageNumbers");
    if (nums) {
      if (total <= 1) {
        nums.innerHTML = "";
      } else {
        nums.innerHTML = pageWindow(state.page, total)
          .map((n) =>
            n === "…"
              ? `<span class="page-gap" aria-hidden="true">…</span>`
              : `<button class="page-num ${n === state.page ? "active" : ""}" data-page="${n}" ${n === state.page ? 'aria-current="page"' : ""} aria-label="Page ${n}">${n}</button>`
          )
          .join("");
      }
    }
    const sizeSel = $("#pageSizeSel");
    if (sizeSel && sizeSel.value !== String(state.pageSize)) sizeSel.value = String(state.pageSize);
    pag.classList.toggle("hidden", filteredCount === 0);
    refreshIcons(pag);
  }

  // ---------- render ----------
  // Row counts for the ACTIVE list (top-level items + subtasks each count 1).
  function activeRowCounts() {
    const items = allItems();
    const subs = items.reduce((n, r) => n + (r.subs || []).length, 0);
    const total = items.length + subs;
    const doneItems = items.filter((r) => effDone(r)).length;
    const doneSubs = items.reduce((n, r) => n + (r.subs || []).filter((s) => isDone(s.id)).length, 0);
    const done = doneItems + doneSubs;
    return { items: items.length, subs, total, done, pending: total - done, pct: total ? Math.round((done / total) * 100) : 0 };
  }
  // Row counts for ANY list (analytics across lists).
  // Every row counts 1: parent and each subtask are independent.
  function listRowCounts(list) {
    const m = state.listState[list.id] || {};
    let total = 0, done = 0;
    (list.items || []).forEach((it) => {
      const subs = Array.isArray(it.subs) ? it.subs : [];
      total += 1;
      if (m[it.id]) done += 1;
      subs.forEach((s) => {
        total += 1;
        if (m[s.id]) done += 1;
      });
    });
    return { total, done, pending: total - done, pct: total ? Math.round((done / total) * 100) : 0 };
  }
  const REDUCED_MOTION = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Animated number count-up (KPI cards + analytics). Only used for the boot
  // sequence — every later render sets values instantly.
  function countUp(el, to, fmt) {
    if (!el || REDUCED_MOTION) { if (el) el.textContent = fmt(to); return; }
    const from = 0, dur = 750, t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(from + (to - from) * eased));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // Staggered fade-up entrance for the active view's cards/panels.
  function playEntrance() {
    if (REDUCED_MOTION) return;
    const root = document.getElementById("view-" + state.view);
    if (!root) return;
    root.classList.remove("enter");
    void root.offsetWidth; // restart CSS animations
    Array.from(root.children).forEach((el, i) => {
      el.style.setProperty("--d", Math.min(i, 8) * 70 + "ms");
    });
    root.classList.add("enter");
  }
  function renderStats(rows) {
    const { total, done, pending, pct } = activeRowCounts();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    if (state.bootAnim) {
      countUp(document.getElementById("statTotal"), total, String);
      countUp(document.getElementById("statDone"), done, String);
      countUp(document.getElementById("statPending"), pending, String);
      countUp(document.getElementById("statPct"), pct, (v) => v + "%");
    } else {
      set("statTotal", total);
      set("statDone", done);
      set("statPending", pending);
      set("statPct", pct + "%");
    }
    set("kpiTotalSub", `${pending} pending · ${done} done`);
    set("kpiDoneSub", total ? `${pct}% complete` : "No items");
    set("kpiPendingSub", pending === 0 && total > 0 ? "All clear — nice work" : `${pending} left to do`);
    set("progressText", `${done} / ${total} done`);
    set("progressHint", `${pct}% complete · ${pending} remaining`);
    set("countLabel", `${rows.length} filtered · ${total} total`);
    set("countLabel2", `${rows.length} filtered · ${total} total · `);
    set("navCount", total);
    const bar = $("#progressBar");
    if (bar) bar.style.width = pct + "%";
    const ring = $("#ringFg");
    if (ring) {
      const circ = 2 * Math.PI * 26;
      ring.style.strokeDasharray = String(circ);
      ring.style.strokeDashoffset = String(circ - (circ * pct) / 100);
    }
    const sideBar = $("#sideMiniBar");
    if (sideBar) sideBar.style.width = pct + "%";
    const sidePct = $("#sidePct");
    if (sidePct) sidePct.textContent = pct + "% done";
    // storage line
    const footKey = $("#storageKey");
    if (footKey) footKey.textContent = `localStorage["${C.LIST_STATE_KEY}"]`;
  }

  function renderAnalytics() {
    const box = document.getElementById("anaDonut");
    if (!box) return;
    const c = activeRowCounts();
    const R = 52, CIRC = 2 * Math.PI * R;
    const off = CIRC - (CIRC * c.pct) / 100;
    // On boot the ring fills from empty (animated via CSS transition).
    const start = state.bootAnim ? CIRC : off;
    box.innerHTML = `<svg width="124" height="124" viewBox="0 0 124 124" role="img" aria-label="${c.pct}% done">`
      + `<circle cx="62" cy="62" r="${R}" fill="none" stroke="var(--bar-track)" stroke-width="13"/>`
      + `<circle class="donut-fg" cx="62" cy="62" r="${R}" fill="none" stroke="var(--success)" stroke-width="13" stroke-linecap="round" stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${start.toFixed(1)}" transform="rotate(-90 62 62)"/>`
      + `<text x="62" y="59" text-anchor="middle" font-size="21" font-weight="800" fill="var(--fg)">${c.pct}%</text>`
      + `<text x="62" y="77" text-anchor="middle" font-size="11" fill="var(--fg-muted)">${c.done}/${c.total}</text></svg>`;
    if (state.bootAnim) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const fg = box.querySelector(".donut-fg");
        if (fg) fg.style.strokeDashoffset = off.toFixed(1);
      }));
    }
    const legend = document.getElementById("anaLegend");
    if (legend) legend.innerHTML =
      `<div class="li"><span class="sw" style="background:var(--success)"></span>Done<b>${c.done}</b></div>`
      + `<div class="li"><span class="sw" style="background:var(--bar-track)"></span>Pending<b>${c.pending}</b></div>`
      + `<div class="li"><span class="sw" style="background:var(--accent)"></span>Subtasks<b>${c.subs}</b></div>`;
    const scope = document.getElementById("anaScope");
    const l = activeList();
    if (scope) scope.textContent = l ? l.name : "Active checklist";
    const listsEl = document.getElementById("anaLists");
    if (listsEl) {
      listsEl.innerHTML = !state.lists.length ? `<div class="hint">No checklists yet.</div>` : state.lists.map((x) => {
        const k = listRowCounts(x);
        return `<button class="ana-list-row${x.id === state.activeId ? " active" : ""}" data-analist="${esc(x.id)}" title="Open ${esc(x.name)}">`
          + `<span class="nm">${esc(x.name)}</span><span class="ct">${k.done}/${k.total}</span>`
          + `<span class="track"><span style="display:block;height:100%;width:${k.pct}%;background:var(--bar-fill);border-radius:inherit"></span></span></button>`;
      }).join("");
    }
    const weekEl = document.getElementById("anaWeek");
    if (weekEl) {
      const log = Store.loadActivity();
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const start = midnight.getTime() - i * 864e5;
        const n = log.filter((e) => e.t >= start && e.t < start + 864e5).length;
        days.push({ n, label: i === 0 ? "Today" : new Date(start).toLocaleDateString(undefined, { weekday: "narrow" }) });
      }
      const max = Math.max(1, ...days.map((d) => d.n));
      weekEl.innerHTML = days.map((d) => `<div class="day${d.n ? "" : " zero"}"><b>${d.n}</b><i style="height:${Math.max(4, Math.round((d.n / max) * 64))}px"></i><span>${esc(d.label)}</span></div>`).join("");
    }
  }

  function renderSegCounts() {
    const total = allItems().length;
    const done = allItems().filter((r) => isDone(r.id)).length;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("countAll", total);
    set("countActive", total - done);
    set("countDone", done);
  }

  function updateNavBadges() {
    const total = allItems().length;
    const log = Store.loadActivity();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("navCount", total);
    set("navActivityCount", log.length);
  }

  function timeAgo(ts) {
    const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return s + "s ago";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    const d = Math.floor(h / 24);
    if (d < 30) return d + "d ago";
    try { return new Date(ts).toLocaleDateString(); } catch { return "earlier"; }
  }
  const ACT_META = {
    verify: { icon: "check-check", cls: "green", label: "Completed" },
    reopen: { icon: "rotate-ccw", cls: "amber", label: "Reopened" },
    bulk: { icon: "layers", cls: "blue", label: "Bulk" },
    add: { icon: "plus", cls: "blue", label: "Added" },
    edit: { icon: "pencil", cls: "blue", label: "Edited" },
    remove: { icon: "trash-2", cls: "red", label: "Removed" },
  };
  function activityItemHTML(e) {
    const m = ACT_META[e.kind] || { icon: "info", cls: "blue", label: "Event" };
    return `<li class="t-item">
      <span class="t-dot ${m.cls}"><i data-lucide="${m.icon}"></i></span>
      <div class="t-body"><b>${esc(m.label)}</b>${e.list ? `<span class="chip">${esc(e.list)}</span>` : ""}<span class="t-text" title="${esc(e.text || "")}">${esc(e.text || "")}</span></div>
      <time class="t-time" title="${esc(new Date(e.t).toLocaleString())}">${esc(timeAgo(e.t))}</time>
    </li>`;
  }
  function renderActivityInto(listId, emptyId, limit) {
    const list = document.getElementById(listId);
    if (!list) return;
    const log = Store.loadActivity();
    const rows = typeof limit === "number" ? log.slice(0, limit) : log;
    list.innerHTML = rows.map(activityItemHTML).join("");
    const empty = document.getElementById(emptyId);
    if (empty) empty.classList.toggle("hidden", log.length !== 0);
    refreshIcons(list);
  }
  function renderRecent() { renderActivityInto("recentList", "recentEmpty", 5); }

  // ---------- activity view pagination (default 8 per page) ----------
  function actPageSize() { return state.apageSize <= 0 ? 0 : state.apageSize; }
  function actTotalPages(count) {
    const ps = actPageSize();
    if (ps <= 0) return 1; // "All" → single page
    return Math.max(1, Math.ceil(count / ps));
  }
  function gotoActPage(n) {
    const total = actTotalPages(Store.loadActivity().length);
    state.apage = Math.min(Math.max(1, n), total);
    render();
  }
  function renderActivity() {
    const list = document.getElementById("activityList");
    if (!list) return;
    const log = Store.loadActivity();
    const total = actTotalPages(log.length);
    if (state.apage < 1) state.apage = 1;
    if (state.apage > total) state.apage = total;
    const ps = actPageSize();
    const showAll = ps <= 0;
    const start = log.length === 0 ? 0 : showAll ? 0 : (state.apage - 1) * ps;
    const pageRows = showAll ? log : log.slice(start, start + ps);
    list.innerHTML = pageRows.map(activityItemHTML).join("");
    const empty = document.getElementById("activityEmpty");
    if (empty) empty.classList.toggle("hidden", log.length !== 0);
    const pag = document.getElementById("actPagination");
    if (pag) pag.classList.toggle("hidden", log.length === 0);
    const info = document.getElementById("actPageInfo");
    if (info) info.textContent = log.length === 0 ? "" : showAll ? `Showing all ${log.length}` : `Showing ${start + 1}–${Math.min(log.length, start + ps)} of ${log.length}`;
    const prev = document.getElementById("actPrev");
    if (prev) prev.disabled = state.apage <= 1;
    const next = document.getElementById("actNext");
    if (next) next.disabled = state.apage >= total;
    const nums = document.getElementById("actPageNumbers");
    if (nums) {
      nums.innerHTML = total <= 1 ? "" : pageWindow(state.apage, total)
        .map((n) => n === "…"
          ? `<span class="page-gap" aria-hidden="true">…</span>`
          : `<button class="page-num ${n === state.apage ? "active" : ""}" data-apage="${n}" ${n === state.apage ? 'aria-current="page"' : ""} aria-label="Activity page ${n}">${n}</button>`)
        .join("");
    }
    const sizeSel = document.getElementById("actPageSizeSel");
    if (sizeSel && sizeSel.value !== String(state.apageSize)) sizeSel.value = String(state.apageSize);
    refreshIcons(list);
    if (pag) refreshIcons(pag);
  }

  function storageBytes(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? new Blob([raw]).size : 0;
    } catch { return 0; }
  }
  function fmtBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(2) + " MB";
  }
  function syncSettings() {
    const themeSeg = $("#setThemeSeg");
    if (themeSeg) $$("button", themeSeg).forEach((b) => b.classList.toggle("active", b.dataset.settheme === document.documentElement.dataset.theme));
    const densSeg = $("#setDensitySeg");
    if (densSeg) $$("button", densSeg).forEach((b) => b.classList.toggle("active", b.dataset.setdensity === state.density));
    const s1 = $("#setSortSel");
    if (s1 && s1.value !== state.sort) s1.value = state.sort;
    const s2 = $("#setPageSizeSel");
    if (s2 && s2.value !== String(state.pageSize)) s2.value = String(state.pageSize);
    const b1 = storageBytes(C.LISTS_KEY);
    const b2 = storageBytes(C.LIST_STATE_KEY);
    const b3 = storageBytes(C.ACTIVITY_KEY);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("useLists", fmtBytes(b1));
    set("useStatus", fmtBytes(b2));
    set("useActivity", fmtBytes(b3));
    set("useTotal", fmtBytes(b1 + b2 + b3));
  }

  // ---------- checklist switcher (sidebar + toolbar) ----------
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
    catch { return ""; }
  }
  function renderSidebarLists() {
    // Sidebar checklist pagination (6 per page). Follows the active list
    // only when it changes — manual page browsing is never yanked away.
    const totalPages = Math.max(1, Math.ceil(state.lists.length / C.SIDE_PAGE_SIZE));
    let scrollSideToActive = false;
    if (state.sidePageFor !== state.activeId) {
      state.sidePageFor = state.activeId;
      const idx = state.lists.findIndex((l) => l.id === state.activeId);
      if (idx >= 0) state.sidePage = Math.floor(idx / C.SIDE_PAGE_SIZE) + 1;
      scrollSideToActive = true;
    }
    if (state.sidePage < 1) state.sidePage = 1;
    if (state.sidePage > totalPages) state.sidePage = totalPages;
    const start = (state.sidePage - 1) * C.SIDE_PAGE_SIZE;
    const slice = state.lists.slice(start, start + C.SIDE_PAGE_SIZE);
    const box = document.getElementById("sideLists");
    if (box) {
      // The active checklist button shares the .nav-item.active look with
      // the view nav — highlight it only in the checklist view so landing
      // on overview shows just Overview as active.
      const showListActive = state.view === "checklist";
      box.innerHTML = slice
        .map((l) => {
          const pending = l.items.length - listDoneCount(l);
          return `<button class="nav-item${showListActive && l.id === state.activeId ? " active" : ""}" data-listid="${esc(l.id)}" title="${esc(l.name)} — ${l.items.length} items">
            <i data-lucide="clipboard-list"></i><span>${esc(l.name)}</span>
            <span class="nav-badge">${pending}</span>
          </button>`;
        })
        .join("");
      refreshIcons(box);
    }
    if (scrollSideToActive && box) {
      // Keep the newly activated list in view (touches only the nav
      // scroller — never the page scroll).
      const activeBtn = box.querySelector(".nav-item.active");
      const nav = box.closest(".nav");
      if (activeBtn && nav) {
        const bTop = activeBtn.offsetTop;
        const bBottom = bTop + activeBtn.offsetHeight;
        if (bTop < nav.scrollTop) nav.scrollTop = bTop;
        else if (bBottom > nav.scrollTop + nav.clientHeight) nav.scrollTop = bBottom - nav.clientHeight;
      }
    }
    const pager = document.getElementById("sidePager");
    if (pager) {
      pager.classList.toggle("hidden", totalPages <= 1);
      const info = document.getElementById("sidePageInfo");
      if (info) info.textContent = `${state.sidePage}/${totalPages} · ${state.lists.length} lists`;
      const prev = document.getElementById("sidePrev");
      if (prev) prev.disabled = state.sidePage <= 1;
      const next = document.getElementById("sideNext");
      if (next) next.disabled = state.sidePage >= totalPages;
    }
    const sel = document.getElementById("checklistSel");
    const l = activeList();
    if (sel) {
      sel.innerHTML = state.lists
        .map((x) => `<option value="${esc(x.id)}"${x.id === state.activeId ? " selected" : ""}>${esc(x.name)} (${x.items.length})</option>`)
        .join("");
    }
    const meta = document.getElementById("clMeta");
    if (meta && l) meta.textContent = `${l.items.length} items · updated ${fmtDate(l.updatedAt)}`;
    const descBlock = document.getElementById("listDescBlock");
    if (descBlock) {
      const txt = document.getElementById("listDescText");
      const has = !!(l && l.description);
      descBlock.classList.toggle("has-text", has);
      descBlock.classList.toggle("is-empty", !has);
      if (txt) {
        if (has) txt.innerHTML = renderRich(l.description);
        else txt.textContent = "No description yet.";
      }
    }
    if (state.view === "checklist" && l) {
      const title = document.getElementById("viewTitle");
      if (title) title.textContent = l.name;
    }
    const delBtn = document.getElementById("deleteListBtn");
    if (delBtn) delBtn.disabled = state.lists.length === 0;
  }

  function tagsHTML(tags) {
    const list = Array.isArray(tags) ? tags.filter((t) => typeof t === "string" && t) : [];
    if (!list.length) return "";
    return `<span class="tags">${list.map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</span>`;
  }

  function fmtTaskTime(ts) {
    if (typeof ts !== "number" || !ts) return "";
    try {
      const d = new Date(ts);
      const full = d.toLocaleString();
      const display = d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      return `<span class="task-time" title="${esc(full)}">${esc(display)}</span>`;
    } catch { return ""; }
  }

  function subHTML(s, parentId, subIdx) {
    const d = isDone(s.id);
    const n = (typeof subIdx === "number" ? subIdx : 0) + 1;
    return `<li class="sub ${d ? "done" : ""}" data-id="${esc(s.id)}" data-parent="${esc(parentId)}">
      <input class="cbx" type="checkbox" ${d ? "checked" : ""} aria-label="Complete: #${n} - ${esc(s.title)}" data-act="subtoggle" />
      <div class="sub-main">
        <div class="title-row"><span class="t" data-act="subtoggle-label" role="button" tabindex="0" title="${esc(s.title)} (Click to toggle this subtask only)"><span class="task-id mono">#${n}</span><span class="task-sep"> - </span>${esc(truncTitle(s.title))}</span>${tagsHTML(s.tags)}${fmtTaskTime(s.createdAt)}</div>
        ${s.description ? `<div class="desc" data-act="desctoggle" title="Click to expand / collapse">${renderRich(s.description)}</div>` : ""}
      </div>
      <span class="row-actions">
        <button class="mini-btn" data-act="subcopy" title="Copy subtask" aria-label="Copy ${esc(shortName(s.title))}"><i data-lucide="copy"></i></button>
        <button class="mini-btn" data-act="subedit" title="Edit subtask" aria-label="Edit ${esc(shortName(s.title))}"><i data-lucide="pencil"></i></button>
        <button class="mini-btn danger" data-act="subdel" title="Delete subtask" aria-label="Delete ${esc(shortName(s.title))}"><i data-lucide="trash-2"></i></button>
      </span>
    </li>`;
  }

  function rowHTML(r, idx) {
    const checked = effDone(r);
    const subs = r.shownSubs || [];
    const allSubs = r.subs || [];
    const doneSubs = allSubs.filter((s) => isDone(s.id)).length;
    const collapsed = state.collapsed.has(r.id);
    const expanded = !collapsed || state.query.trim().length > 0;
    const subList = subs.length && expanded
      ? `<ul class="subs">${subs.map((s, si) => subHTML(s, r.id, si)).join("")}</ul>` : "";
    return `
      <li class="row ${checked ? "done" : ""}" data-id="${esc(r.id)}" data-title="${esc(r.title)}">
        <div class="row-check">
          <button class="expander${allSubs.length ? "" : " hidden"}${collapsed && allSubs.length ? " closed" : ""}" data-act="exp" title="${allSubs.length ? (expanded ? "Collapse subtasks" : "Expand subtasks") : "No subtasks"}" aria-label="Toggle subtasks" aria-expanded="${expanded}"><i data-lucide="chevron-down"></i></button>
          <input class="cbx" type="checkbox" ${checked ? "checked" : ""} aria-label="Complete: #${idx + 1} - ${esc(r.title)} (independent of subtasks)" data-act="toggle" />
        </div>
        <div class="row-main">
          <div class="title-row"><span class="title" data-act="toggle-label" role="button" tabindex="0" title="${esc(r.title)} (Click to toggle this task only, subtasks stay independent)"><span class="task-id mono">#${idx + 1}</span><span class="task-sep"> - </span>${esc(truncTitle(r.title))}</span>${tagsHTML(r.tags)}</div>
          ${r.description ? `<div class="desc" data-act="desctoggle" title="Click to expand / collapse">${renderRich(r.description)}</div>` : ""}
          ${allSubs.length ? `<div class="meta"><span class="chip subcount" title="Parent is independent — ${doneSubs} of ${allSubs.length} subtasks done">${doneSubs}/${allSubs.length} subs · parent separate</span></div>` : ""}
          ${subList}
        </div>
        <div class="row-side">
          ${fmtTaskTime(r.createdAt)}
          <span class="status ${checked ? "done" : "todo"}">${checked ? `<i data-lucide="check-check"></i>done` : `<i data-lucide="clock"></i>pending`}</span>
          <span class="row-actions">
            <button class="mini-btn" data-act="copy" title="Copy item text" aria-label="Copy ${esc(shortName(r.title))}"><i data-lucide="copy"></i></button>
            <button class="mini-btn" data-act="addsub" title="Add subtask" aria-label="Add subtask to ${esc(shortName(r.title))}"><i data-lucide="list-plus"></i></button>
            <button class="mini-btn" data-act="edit" title="Edit item" aria-label="Edit ${esc(shortName(r.title))}"><i data-lucide="pencil"></i></button>
            <button class="mini-btn danger" data-act="del" title="Delete item and its subtasks" aria-label="Delete ${esc(shortName(r.title))}"><i data-lucide="trash-2"></i></button>
          </span>
        </div>
      </li>`;
  }

  function render() {
    const list = $("#checklist");
    const empty = $("#emptyState");
    const emptyTitle = $("#emptyTitle");
    const emptySub = $("#emptySub");
    if (!list) return;
    if (state.sort === "default") state.sort = "newest"; // legacy persisted value
    const filtered = visibleItems();
    clampPage(filtered.length);
    const { slice, start } = currentSlice(filtered);
    renderStats(filtered);
    renderSegCounts();
    // density
    list.classList.toggle("compact", state.density === "compact");
    const densityBtn = $("#densityBtn");
    if (densityBtn) {
      densityBtn.innerHTML = state.density === "compact"
        ? `<i data-lucide="eye"></i><span>Comfortable</span>`
        : `<i data-lucide="eye-off"></i><span>Compact</span>`;
    }
    // sort select
    const sortSel = $("#sortSel");
    if (sortSel && sortSel.value !== state.sort) sortSel.value = state.sort;
    // seg active
    $$(".seg button").forEach((b) => b.classList.toggle("active", b.dataset.filter === state.filter));

    if (!filtered.length) {
      list.innerHTML = "";
      if (empty) {
        empty.classList.remove("hidden");
        const hasQuery = state.query.trim().length > 0;
        if (emptyTitle) emptyTitle.textContent = hasQuery ? "No items match your search" : state.filter === "completed" ? "Nothing completed yet" : state.filter === "active" ? "Everything is done" : "No items yet";
        if (emptySub) emptySub.textContent = hasQuery ? `Try a different keyword — ${allItems().length} items in this list.` : "Add an item or adjust the filter to get started.";
      }
    } else {
      if (empty) empty.classList.add("hidden");
      list.innerHTML = slice.map((r, i) => rowHTML(r, start + i)).join("");
    }
    // First-reveal row stagger (boot only; later renders are instant).
    list.classList.toggle("enter-rows", !!state.bootAnim);
    renderPagination(filtered.length);
    // select-all checkbox state (parents + subtasks each count 1, independent)
    const selAll = $("#selectAll");
    if (selAll) {
      const items = allItems();
      const total = items.reduce((n, r) => n + 1 + (r.subs || []).length, 0);
      const done = items.reduce((n, r) => n + (isDone(r.id) ? 1 : 0) + (r.subs || []).filter((s) => isDone(s.id)).length, 0);
      selAll.checked = total > 0 && done === total;
      selAll.indeterminate = done > 0 && done < total;
    }
    updateNavBadges();
    renderSidebarLists();
    renderRecent();
    renderAnalytics();
    renderActivity();
    syncSettings();
    refreshIcons(list);
    refreshIcons(document);
  }

  function persistAndRender(activity) {
    touchActive();
    saveAll();
    if (activity) {
      const l = activeList();
      Store.pushActivity({ list: l ? l.name : "", ...activity });
    }
    render();
  }

  // ---------- actions ----------
  async function copyText(text, okTitle) {
    try {
      await navigator.clipboard.writeText(text);
      toast("success", okTitle || "Copied to clipboard", text.length > 90 ? text.slice(0, 90) + "…" : text);
      return true;
    } catch {
      // fallback for non-secure contexts
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        toast("success", okTitle || "Copied to clipboard");
        return true;
      } catch {
        toast("warn", "Copy failed", "Use Export .txt instead.");
        return false;
      }
    }
  }

  // Inline form validation: message under the field + red border.
  // Returns true when valid (msg empty).
  function setFieldError(inputId, errId, msg) {
    const input = document.getElementById(inputId);
    const err = document.getElementById(errId);
    if (err) {
      err.textContent = msg || "";
      err.classList.toggle("hidden", !msg);
    }
    if (input) {
      input.classList.toggle("input-error", !!msg);
      if (msg) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
    return !msg;
  }
  function clearSubsCreateError() {
    const err = document.getElementById("subsCreateError");
    if (err) {
      err.textContent = "";
      err.classList.add("hidden");
    }
  }

  // Reload the page to root (overview). State persists in localStorage,
  // so this is a fresh boot straight into the overview.
  function goRoot() {
    try {
      if (location.hash !== "#/overview") location.hash = "#/overview";
    } catch {}
    location.reload();
  }

  function wire() {
    // theme
    const themeBtns = [$("#themeBtn"), $("#themeBtnSide")].filter(Boolean);
    const applyTheme = (t) => {
      document.documentElement.dataset.theme = t;
      Store.setTheme(t);
      themeBtns.forEach((b) => {
        b.innerHTML = t === "dark" ? `<i data-lucide="sun"></i>` : `<i data-lucide="moon"></i>`;
        b.setAttribute("aria-label", t === "dark" ? "Switch to light mode" : "Switch to dark mode");
        b.title = b.getAttribute("aria-label");
      });
      refreshIcons(document);
    };
    applyTheme(Store.getTheme());
    themeBtns.forEach((b) => b.addEventListener("click", () =>
      applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark")));

    // sidebar mobile drawer (closed by backdrop click)
    const scrim = $("#scrim");
    if (scrim) scrim.addEventListener("click", () => document.body.classList.remove("nav-open"));
    // sidebar navigation → operational views (hash-routed).
    // Overview always reloads fresh to root; other views switch in place.
    $$(".nav-item[data-view]").forEach((n) => n.addEventListener("click", () => {
      if (n.dataset.view === "overview") { goRoot(); return; }
      setView(n.dataset.view);
    }));
    window.addEventListener("hashchange", () => {
      const v = viewFromHash();
      if (v !== state.view) setView(v, { hash: false });
    });

    // search (toolbar + topbar stay in sync)
    const search = $("#search");
    const topSearch = $("#topSearch");
    const syncSearch = (val, src) => {
      state.query = val;
      state.page = 1;
      if (search && src !== search) search.value = val;
      if (topSearch && src !== topSearch) topSearch.value = val;
      render();
    };
    if (search) search.addEventListener("input", (e) => syncSearch(e.target.value, search));
    if (topSearch) topSearch.addEventListener("input", (e) => syncSearch(e.target.value, topSearch));

    // segmented filter
    $$(".seg button").forEach((b) => b.addEventListener("click", () => {
      state.filter = b.dataset.filter || "all";
      state.page = 1;
      render();
    }));

    // sort + density
    const sortSel = $("#sortSel");
    if (sortSel) {
      sortSel.value = state.sort;
      sortSel.addEventListener("change", () => { state.sort = sortSel.value; Store.setSort(state.sort); state.page = 1; render(); });
    }
    const densityBtn = $("#densityBtn");
    if (densityBtn) densityBtn.addEventListener("click", () => {
      state.density = state.density === "compact" ? "comfortable" : "compact";
      Store.setDensity(state.density);
      render();
    });

    // select all checkbox (independent: checks every parent + every subtask)
    const selAll = $("#selectAll");
    if (selAll) selAll.addEventListener("change", () => {
      if (selAll.checked) {
        allItems().forEach((r) => {
          setDone(r.id, true);
          (r.subs || []).forEach((s) => setDone(s.id, true));
        });
        persistAndRender({ kind: "bulk", text: "Completed all items" });
        toast("success", "All items completed");
      } else {
        const l = activeList();
        if (l) state.listState[l.id] = {};
        persistAndRender({ kind: "bulk", text: "Reset all progress" });
        toast("info", "All progress cleared");
      }
    });

    // list delegation (items + subtasks)
    // Pending task/subtask delete awaiting confirmation in #deleteItemModal.
    let pendingItemDelete = null;
    function askDeleteItem(pending) {
      pendingItemDelete = pending;
      const titleEl = document.getElementById("deleteItemTitle");
      const descEl = document.getElementById("deleteItemDesc");
      if (pending.type === "subtask") {
        if (titleEl) titleEl.textContent = "Delete subtask?";
        if (descEl) descEl.innerHTML = `This removes subtask <b>${esc(pending.subTitle)}</b> from <b>${esc(pending.parentTitle)}</b>. This cannot be undone.`;
      } else {
        const n = pending.subCount || 0;
        if (titleEl) titleEl.textContent = "Delete task?";
        if (descEl) descEl.innerHTML = `This removes <b>${esc(pending.title)}</b>${n ? ` and its <b>${n} subtask${n === 1 ? "" : "s"}</b>` : ""}. This cannot be undone.`;
      }
      openModal("deleteItemModal");
    }
    function findSub(parentId, subId) {
      const p = itemById(parentId);
      return p && Array.isArray(p.subs) ? p.subs.find((s) => s.id === subId) || null : null;
    }
    function toggleExp(id) {
      if (state.collapsed.has(id)) state.collapsed.delete(id);
      else state.collapsed.add(id);
      Store.setCollapsedIds([...state.collapsed]);
      render();
    }
    const list = $("#checklist");
    if (list) {
      list.addEventListener("click", (e) => {
        const actEl = e.target.closest("[data-act]");
        const act0 = actEl ? actEl.dataset.act : null;
        // Code copy works anywhere (descriptions + previews) — never toggles.
        if (act0 === "codecopy") {
          e.stopPropagation();
          const pre = e.target.closest("pre.codeblock");
          const codeEl = pre ? pre.querySelector("code") : null;
          const codeText = codeEl ? codeEl.innerText : "";
          if (codeText) copyText(codeText, "Code copied");
          return;
        }
        // Description expand / collapse — never toggles the checkbox.
        if (act0 === "desctoggle") {
          e.stopPropagation();
          const d = actEl.closest ? actEl : e.target.closest(".desc");
          if (d && d.classList) d.classList.toggle("expanded");
          return;
        }
        const subRow = e.target.closest(".sub");
        if (subRow) {
          const pid = subRow.dataset.parent;
          const sub = pid && findSub(pid, subRow.dataset.id);
          if (!sub) return;
          const act = actEl ? actEl.dataset.act : null;
          if (act === "subcopy") {
            e.stopPropagation();
            copyText(sub.title, "Subtask copied");
            return;
          }
          if (act === "subedit") {
            e.stopPropagation();
            openEditModal(sub.id, pid);
            return;
          }
          if (act === "subdel") {
            e.stopPropagation();
            const p = itemById(pid);
            askDeleteItem({ type: "subtask", parentId: pid, subId: sub.id, subTitle: sub.title, parentTitle: p ? p.title : "" });
            return;
          }
          if (act === "subtoggle-label") {
            // Only the subtask label toggles the subtask.
            // Checkbox itself is handled via the change event below.
            const now = !isDone(sub.id);
            setDone(sub.id, now);
            persistAndRender({ kind: now ? "verify" : "reopen", text: sub.title });
          }
          // Any other click inside a subtask row (background, actions gap…)
          // does nothing — it never touches the parent.
          return;
        }
        const row = e.target.closest(".row");
        if (!row) return;
        const id = row.dataset.id;
        const item = id && itemById(id);
        if (!item) return;
        const title = item.title;
        const act = actEl ? actEl.dataset.act : null;
        if (act === "copy") {
          e.stopPropagation();
          copyText(title, "Item copied");
          return;
        }
        if (act === "addsub") {
          e.stopPropagation();
          openAddModal(id);
          return;
        }
        if (act === "edit") {
          e.stopPropagation();
          openEditModal(id, null);
          return;
        }
        if (act === "exp") {
          e.stopPropagation();
          toggleExp(id);
          return;
        }
        if (act === "del") {
          e.stopPropagation();
          askDeleteItem({ type: "task", taskId: id, title, subCount: (item.subs || []).length });
          return;
        }
        if (act === "toggle-label") {
          // Only the parent title/checkbox toggles the parent — subtasks are
          // never touched (fully independent). Checkbox input itself is
          // handled via the change event below. Clicks anywhere else on the
          // row (background, chips, description, tags) do nothing.
          const now = !isDone(item.id);
          setDone(item.id, now);
          persistAndRender({ kind: now ? "verify" : "reopen", text: title });
        }
      });
      list.addEventListener("change", (e) => {
        const cb = e.target.closest('[data-act="toggle"], [data-act="subtoggle"]');
        if (!cb) return;
        if (cb.dataset.act === "subtoggle") {
          const subRow = e.target.closest(".sub");
          const pid = subRow && subRow.dataset.parent;
          const sub = pid && findSub(pid, subRow.dataset.id);
          if (!sub) return;
          setDone(sub.id, cb.checked);
          persistAndRender({ kind: cb.checked ? "verify" : "reopen", text: sub.title });
          return;
        }
        const row = e.target.closest(".row");
        const id = row && row.dataset.id;
        const item = id && itemById(id);
        if (!item) return;
        // Independent parent toggle — subtasks untouched.
        setDone(item.id, cb.checked);
        persistAndRender({ kind: cb.checked ? "verify" : "reopen", text: item.title });
      });
      list.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          const t = e.target.closest('[data-act="toggle-label"], [data-act="subtoggle-label"]');
          if (t) {
            e.preventDefault();
            t.click();
          }
        }
      });
    }

    // bulk actions (operate on the ACTIVE checklist).
    // Entry points: list-head Reset, select-all checkbox, settings buttons.
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
    function exportName(ext) {
      const l = activeList();
      return `${slug(l ? l.name : C.EXPORT_PREFIX)}-${todayStr()}.${ext}`;
    }
    function doUncheckAll() {
      const l = activeList();
      if (l) state.listState[l.id] = {};
      persistAndRender({ kind: "bulk", text: "Reset all progress" });
      toast("info", "Reset complete", "All items marked pending.");
    }
    function doExportTxt() {
      const rows = [...visibleItems()].sort((a, b) => Number(effDone(b)) - Number(effDone(a)) || a.title.localeCompare(b.title));
      download(exportName("txt"), toExportTxt(rows.length ? rows : allItems()));
      toast("success", "Exported .txt", `${rows.length || allItems().length} rows · todo_checklist format`);
    }
    async function doCopyList() {
      const rows = visibleItems();
      await copyText(toExportTxt(rows.length ? rows : allItems()), "Checklist copied");
    }
    function openClearModal() {
      const l = activeList();
      const desc = document.getElementById("clearModalDesc");
      if (desc && l) desc.innerHTML = `This resets progress for <b>${esc(l.name)}</b> in this browser. Items are untouched — you can start over.`;
      openModal("clearModal");
    }
    on("uncheckAllBtn2", doUncheckAll);
    on("confirmClear", () => {
      const l = activeList();
      if (l) state.listState[l.id] = {};
      persistAndRender({ kind: "bulk", text: "Cleared saved data" });
      closeModal("clearModal");
      toast("info", "Local data cleared");
    });

    // item dialog — create item (+ optional multiple subtasks at creation
    // time), create single subtask, or edit either (title + description
    // with ```code``` preview).
    // addTarget: null | {parentId} | {editId} | {editSubId, parentId}
    let addTarget = null;
    function descVal() {
      const d = document.getElementById("itemDescInput");
      return ((d && d.value) || "").trim().slice(0, 2000);
    }
    // Tags: comma-separated input → normalized lowercase list (max 12).
    function parseTags(raw) {
      const seen = new Set();
      const out = [];
      String(raw || "").split(",").forEach((part) => {
        const t = part.trim().replace(/^#+/, "").toLowerCase().slice(0, 30);
        if (t && !seen.has(t) && out.length < 12) { seen.add(t); out.push(t); }
      });
      return out;
    }
    function tagsVal() {
      const el = document.getElementById("itemTagsInput");
      return parseTags(el ? el.value : "");
    }
    function setTagsInput(tags) {
      const el = document.getElementById("itemTagsInput");
      if (el) el.value = (tags || []).join(", ");
    }
    function resetSubsCreate() {
      const wrap = document.getElementById("subsCreateWrap");
      const lst = document.getElementById("subsCreateList");
      const chk = document.getElementById("hasSubsChk");
      if (lst) lst.innerHTML = "";
      if (wrap) wrap.classList.add("hidden");
      if (chk) chk.checked = false;
      setTagsInput([]);
      clearSubsCreateError();
    }
    function addSubField(value, tags) {
      const lst = document.getElementById("subsCreateList");
      if (!lst) return;
      const n = lst.children.length + 1;
      const row = document.createElement("div");
      row.className = "sub-field-row";
      row.innerHTML = `<input class="text-input sub-create-input" type="text" placeholder="Subtask ${n} — e.g. Draft outline" maxlength="200" /><input class="text-input sub-create-tags" type="text" placeholder="tags, optional" maxlength="120" autocomplete="off" /><button type="button" class="mini-btn danger sub-field-remove" title="Remove this subtask" aria-label="Remove subtask field">✕</button>`;
      const inputs = row.querySelectorAll("input");
      if (inputs[0] && value) inputs[0].value = value;
      if (inputs[1] && tags) inputs[1].value = tags;
      const rm = row.querySelector(".sub-field-remove");
      if (rm) rm.addEventListener("click", () => {
        row.remove();
        // renumber placeholders
        Array.from(lst.querySelectorAll(".sub-create-input")).forEach((el, i) => {
          el.placeholder = `Subtask ${i + 1} — e.g. Draft outline`;
        });
        if (!lst.children.length) resetSubsCreate();
      });
      lst.appendChild(row);
      if (inputs[0]) inputs[0].focus();
    }
    function collectSubs() {
      const lst = document.getElementById("subsCreateList");
      if (!lst) return [];
      const seen = new Set();
      const out = [];
      Array.from(lst.children).forEach((row) => {
        const titleEl = row.querySelector(".sub-create-input");
        const tagsEl = row.querySelector(".sub-create-tags");
        const v = ((titleEl && titleEl.value) || "").trim().slice(0, 200);
        const k = v.toLowerCase();
        if (v && !seen.has(k)) {
          seen.add(k);
          out.push({ title: v, tags: parseTags(tagsEl ? tagsEl.value : "") });
        }
      });
      return out;
    }
    function refreshDescPreview() {
      const prev = document.getElementById("descPreview");
      const input = document.getElementById("itemDescInput");
      const toggle = document.getElementById("descPreviewToggle");
      if (!prev || !input) return;
      if (prev.classList.contains("hidden")) {
        if (toggle) toggle.setAttribute("aria-expanded", "false");
        return;
      }
      const raw = (input.value || "").trim();
      prev.innerHTML = raw ? renderRich(raw) : `<span class="muted">Nothing to preview yet — type a description with \`\`\`code\`\`\` blocks.</span>`;
      if (toggle) toggle.setAttribute("aria-expanded", "true");
    }
    function setHasSubsVisible(showCreate) {
      const wrap = document.getElementById("hasSubsWrap");
      const subWrap = document.getElementById("subsCreateWrap");
      if (wrap) wrap.classList.toggle("hidden", !showCreate);
      if (!showCreate && subWrap) subWrap.classList.add("hidden");
    }
    function openAddModal(parentId) {
      addTarget = parentId ? { parentId } : null;
      const p = parentId && itemById(parentId);
      const title = document.getElementById("addTitle");
      const hint = document.getElementById("addHint");
      const confirm = document.getElementById("addConfirmBtn");
      const input = $("#newItemInput");
      const desc = document.getElementById("itemDescInput");
      const prev = document.getElementById("descPreview");
      if (title) title.textContent = p ? "Add subtask" : "Add Task";
      if (hint) hint.textContent = p
        ? `Subtask of "${p.title}". Saved in this browser and included in exports.`
        : "New items are saved in this browser and included in exports.";
      if (confirm) confirm.innerHTML = p ? `<i data-lucide="list-plus"></i>Add subtask` : `<i data-lucide="plus"></i>Add Task`;
      if (input) input.value = "";
      if (desc) desc.value = "";
      setTagsInput([]);
      setFieldError("newItemInput", "newItemError", "");
      if (prev) prev.classList.add("hidden");
      const toggle = document.getElementById("descPreviewToggle");
      if (toggle) { toggle.textContent = "Preview description"; toggle.setAttribute("aria-expanded", "false"); }
      resetSubsCreate();
      // "This task has subtask(s)" + file import only apply to new top-level tasks.
      setHasSubsVisible(!p);
      setImportVisible(!p);
      refreshIcons(document);
      openModal("addModal");
    }
    function openEditModal(id, parentId) {
      const l = activeList();
      if (!l) return;
      let target = null;
      if (parentId) {
        const p = l.items.find((it) => it.id === parentId);
        const s = p && (p.subs || []).find((x) => x.id === id);
        if (!s) return;
        target = { editSubId: id, parentId, title: s.title, description: s.description || "", tags: Array.isArray(s.tags) ? s.tags : [] };
      } else {
        const it = l.items.find((x) => x.id === id);
        if (!it) return;
        target = { editId: id, title: it.title, description: it.description || "", tags: Array.isArray(it.tags) ? it.tags : [] };
      }
      addTarget = target;
      const title = document.getElementById("addTitle");
      const hint = document.getElementById("addHint");
      const confirm = document.getElementById("addConfirmBtn");
      const input = $("#newItemInput");
      const desc = document.getElementById("itemDescInput");
      if (title) title.textContent = parentId ? "Edit subtask" : "Edit item";
      if (hint) hint.textContent = "Changes save to this browser immediately.";
      if (confirm) confirm.innerHTML = `<i data-lucide="pencil"></i>Save changes`;
      if (input) input.value = target.title;
      if (desc) desc.value = target.description;
      setTagsInput(target.tags);
      setFieldError("newItemInput", "newItemError", "");
      const prev = document.getElementById("descPreview");
      if (prev) prev.classList.add("hidden");
      const toggle = document.getElementById("descPreviewToggle");
      if (toggle) { toggle.textContent = "Preview description"; toggle.setAttribute("aria-expanded", "false"); }
      resetSubsCreate();
      // Editing an existing row never shows the multi-subtask creator or file import.
      setHasSubsVisible(false);
      setImportVisible(false);
      refreshIcons(document);
      openModal("addModal");
    }
    on("addBtn", () => openAddModal(null));
    on("emptyAddBtn", () => openAddModal(null));
    // has-subtasks toggle + "add another subtask" + live description preview
    const hasSubsChk = document.getElementById("hasSubsChk");
    if (hasSubsChk) hasSubsChk.addEventListener("change", () => {
      const wrap = document.getElementById("subsCreateWrap");
      if (!wrap) return;
      wrap.classList.toggle("hidden", !hasSubsChk.checked);
      clearSubsCreateError();
      const lst = document.getElementById("subsCreateList");
      if (hasSubsChk.checked && lst && !lst.children.length) addSubField("");
    });
    // Typing clears inline validation messages.
    const newItemInputEl = document.getElementById("newItemInput");
    if (newItemInputEl) newItemInputEl.addEventListener("input", () => setFieldError("newItemInput", "newItemError", ""));
    const checklistNameInputEl = document.getElementById("checklistNameInput");
    if (checklistNameInputEl) checklistNameInputEl.addEventListener("input", () => setFieldError("checklistNameInput", "checklistNameError", ""));
    on("addSubFieldBtn", () => {
      const wrap = document.getElementById("subsCreateWrap");
      if (wrap) wrap.classList.remove("hidden");
      addSubField("");
    });
    // Enter inside a subtask field adds another field; Shift+Enter submits.
    const subsCreateList = document.getElementById("subsCreateList");
    if (subsCreateList) subsCreateList.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target && e.target.classList && e.target.classList.contains("sub-create-input")) {
        e.preventDefault();
        addSubField("");
      }
    });
    if (subsCreateList) subsCreateList.addEventListener("input", clearSubsCreateError);
    on("descPreviewToggle", () => {
      const prev = document.getElementById("descPreview");
      const toggle = document.getElementById("descPreviewToggle");
      if (!prev) return;
      prev.classList.toggle("hidden");
      if (toggle) toggle.textContent = prev.classList.contains("hidden") ? "Preview description" : "Hide preview";
      refreshDescPreview();
    });
    const itemDescInput = document.getElementById("itemDescInput");
    if (itemDescInput) itemDescInput.addEventListener("input", refreshDescPreview);
    const addModalPreviewCopy = document.getElementById("descPreview");
    if (addModalPreviewCopy) addModalPreviewCopy.addEventListener("click", (e) => {
      const btn = e.target.closest && e.target.closest('[data-act="codecopy"]');
      if (!btn) return;
      const pre = btn.closest("pre.codeblock");
      const codeEl = pre ? pre.querySelector("code") : null;
      if (codeEl && codeEl.innerText) copyText(codeEl.innerText, "Code copied");
    });
    // ---- import tasks from .csv / .txt into the ACTIVE checklist ----
    // Minimal CSV parser: quoted fields, "" escapes, \r\n line endings.
    function parseCSV(text) {
      const rows = [];
      let row = [], field = "", inQ = false;
      const s = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inQ) {
          if (ch === '"') {
            if (s[i + 1] === '"') { field += '"'; i++; }
            else inQ = false;
          } else field += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === ",") { row.push(field); field = ""; }
        else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else if (ch === "\r") { /* paired \n follows */ }
        else field += ch;
      }
      row.push(field);
      rows.push(row);
      return rows
        .filter((r) => r.some((c) => c.trim() !== ""))
        .map((r) => r.map((c) => c.trim()));
    }
    function csvTags(cell) {
      return parseTags(String(cell || "").replace(/[;|]/g, ","));
    }
    // CSV shape: `title,tags,description` (header row optional; tags split on ; or |).
    function groupsFromCSV(text) {
      const rows = parseCSV(text);
      if (!rows.length) return [];
      let idx = { title: 0, tags: 1, description: 2 };
      let start = 0;
      const head = rows[0].map((c) => c.toLowerCase());
      if (head.includes("title")) {
        start = 1;
        idx = {
          title: head.indexOf("title"),
          tags: head.indexOf("tags"),
          description: head.indexOf("description") >= 0 ? head.indexOf("description") : head.indexOf("desc"),
        };
      }
      const groups = [];
      rows.slice(start).forEach((r) => {
        const title = (r[idx.title] || "").trim();
        if (!title) return;
        groups.push({
          title,
          tags: idx.tags >= 0 ? csvTags(r[idx.tags] || "") : [],
          description: idx.description >= 0 ? (r[idx.description] || "") : "",
          subs: [],
        });
      });
      return groups;
    }
    function addImportedGroups(groups, sourceName) {
      const l = activeList();
      if (!l) return false;
      const existing = new Set(l.items.map((it) => it.title.toLowerCase()));
      const now = Date.now();
      let added = 0, skipped = 0, subCount = 0;
      groups.slice(0, 500).forEach((g, i) => {
        const title = String(g.title || "").trim().slice(0, 200);
        if (!title || existing.has(title.toLowerCase())) { skipped++; return; }
        existing.add(title.toLowerCase());
        const seenSubs = new Set();
        const subs = (g.subs || []).map((s, j) => {
          const st = String(s.title || "").trim().slice(0, 200);
          if (!st || seenSubs.has(st.toLowerCase())) return null;
          seenSubs.add(st.toLowerCase());
          return { id: Store.uid("s"), title: st, description: Store.cleanDesc(s.description), tags: Store.cleanTags(s.tags), createdAt: now + i * 1000 + j };
        }).filter(Boolean);
        l.items.push({ id: Store.uid("i"), title, description: Store.cleanDesc(g.description), tags: Store.cleanTags(g.tags), createdAt: now + i, subs });
        added++;
        subCount += subs.length;
      });
      if (!added) {
        toast("warn", "Nothing imported", skipped ? "Those tasks are already in this list." : "No tasks found in that file.");
        return false;
      }
      persistAndRender({ kind: "add", text: `Imported ${added} task${added === 1 ? "" : "s"}${subCount ? ` (+${subCount} subtasks)` : ""} from ${sourceName}` });
      state.filter = "all";
      state.query = "";
      state.page = 1;
      if (search) search.value = "";
      if (topSearch) topSearch.value = "";
      render();
      toast("success", `Imported ${added} task${added === 1 ? "" : "s"}`, `${sourceName}${skipped ? ` · ${skipped} skipped (duplicates)` : ""}${groups.length > 500 ? " · capped at 500" : ""}`);
      return true;
    }
    function setImportVisible(show) {
      const w = document.getElementById("importTasksWrap");
      if (w) w.classList.toggle("hidden", !show);
    }
    on("importTasksBtn", () => {
      const f = document.getElementById("importTasksFile");
      if (f) f.click();
    });
    const importTasksFile = $("#importTasksFile");
    if (importTasksFile) importTasksFile.addEventListener("change", () => {
      const file = importTasksFile.files && importTasksFile.files[0];
      importTasksFile.value = "";
      if (!file) return;
      const isCSV = /\.csv$/i.test(file.name || "");
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || "");
        const groups = isCSV
          ? groupsFromCSV(text)
          : parseImportLines(text).map((g) => ({ ...g, description: "", subs: (g.subs || []).map((s) => ({ ...s, description: "" })) }));
        if (!groups.length) { toast("warn", "Nothing to import", "No tasks found in that file."); return; }
        if (!addImportedGroups(groups, file.name || (isCSV ? "CSV file" : "text file"))) return;
        const input = $("#newItemInput");
        if (input) input.value = "";
        const d = document.getElementById("itemDescInput");
        if (d) d.value = "";
        setTagsInput([]);
        const prev = document.getElementById("descPreview");
        if (prev) prev.classList.add("hidden");
        resetSubsCreate();
        closeModal("addModal");
        addTarget = null;
      };
      reader.readAsText(file);
    });
    const addForm = $("#addForm");
    if (addForm) addForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("#newItemInput");
      const val = (input.value || "").trim();
      if (!val) {
        setFieldError("newItemInput", "newItemError", "Please enter a task title — it's required.");
        input.focus();
        return;
      }
      setFieldError("newItemInput", "newItemError", "");
      const desc = descVal();
      const tags = tagsVal();
      const l = activeList();
      if (!l) return;
      const done = () => {
        input.value = "";
        const d = document.getElementById("itemDescInput");
        if (d) d.value = "";
        setTagsInput([]);
        const prev = document.getElementById("descPreview");
        if (prev) prev.classList.add("hidden");
        const tgl = document.getElementById("descPreviewToggle");
        if (tgl) { tgl.textContent = "Preview description"; tgl.setAttribute("aria-expanded", "false"); }
        resetSubsCreate();
        closeModal("addModal");
        addTarget = null;
        render();
      };
      // edit existing subtask
      if (addTarget && addTarget.editSubId) {
        const p = l.items.find((it) => it.id === addTarget.parentId);
        const s = p && (p.subs || []).find((x) => x.id === addTarget.editSubId);
        if (!s) { done(); return; }
        if ((p.subs || []).some((x) => x.id !== s.id && x.title.toLowerCase() === val.toLowerCase())) {
          toast("warn", "Already exists", "That subtask is already on this item.");
          return;
        }
        s.title = val;
        s.description = desc;
        s.tags = tags;
        persistAndRender({ kind: "edit", text: `Edited subtask ${val}` });
        done();
        toast("success", "Subtask updated", val);
        return;
      }
      // edit existing item
      if (addTarget && addTarget.editId) {
        const it = l.items.find((x) => x.id === addTarget.editId);
        if (!it) { done(); return; }
        if (l.items.some((x) => x.id !== it.id && x.title.toLowerCase() === val.toLowerCase())) {
          toast("warn", "Already exists", "That item is already in the list.");
          return;
        }
        it.title = val;
        it.description = desc;
        it.tags = tags;
        persistAndRender({ kind: "edit", text: `Edited item ${val}` });
        done();
        toast("success", "Item updated", val);
        return;
      }
      const parent = addTarget && addTarget.parentId && l.items.find((it) => it.id === addTarget.parentId);
      if (parent) {
        if ((parent.subs || []).some((s) => s.title.toLowerCase() === val.toLowerCase())) {
          toast("warn", "Already exists", "That subtask is already on this item.");
          return;
        }
        parent.subs = parent.subs || [];
        parent.subs.push({ id: Store.uid("s"), title: val, description: desc, tags, createdAt: Date.now() });
        state.collapsed.delete(parent.id);
        persistAndRender({ kind: "add", text: `Added subtask ${val} to ${parent.title}` });
        done();
        toast("success", "Subtask added", val);
        return;
      }
      if (l.items.some((it) => it.title.toLowerCase() === val.toLowerCase())) {
        toast("warn", "Already exists", "That item is already in the list.");
        return;
      }
      // New top-level task — optionally with multiple subtasks created inline.
      let newSubs = [];
      const wantSubs = document.getElementById("hasSubsChk");
      if (wantSubs && wantSubs.checked) {
        const collected = collectSubs();
        if (!collected.length) {
          const errEl = document.getElementById("subsCreateError");
          if (errEl) {
            errEl.textContent = "You checked “has subtask(s)” — please add at least one subtask, or uncheck the box.";
            errEl.classList.remove("hidden");
          }
          const firstSub = document.querySelector("#subsCreateList .sub-create-input");
          if (firstSub) firstSub.focus();
          return;
        }
        const now = Date.now();
        newSubs = collected.map((t, j) => ({ id: Store.uid("s"), title: t.title, description: "", tags: t.tags, createdAt: now + j }));
      }
      l.items.push({ id: Store.uid("i"), title: val, description: desc, tags, createdAt: Date.now(), subs: newSubs });
      persistAndRender({ kind: "add", text: newSubs.length ? `Added ${val} (+${newSubs.length} subtasks)` : val });
      done();
      state.filter = "all";
      state.query = "";
      state.page = 1;
      if (search) search.value = "";
      if (topSearch) topSearch.value = "";
      render();
      toast("success", newSubs.length ? `Item + ${newSubs.length} subtask(s) added` : "Item added", val);
    });

    // ---------- checklist CRUD ----------
    let listModalMode = "create";
    function openChecklistModal(mode) {
      listModalMode = mode;
      const l = activeList();
      const title = document.getElementById("checklistModalTitle");
      const confirm = document.getElementById("checklistModalConfirm");
      const hint = document.getElementById("checklistModalHint");
      const input = document.getElementById("checklistNameInput");
      if (title) title.textContent = mode === "rename" ? "Rename checklist" : "New checklist";
      if (confirm) confirm.innerHTML = mode === "rename"
        ? `<i data-lucide="pencil"></i>Rename`
        : `<i data-lucide="plus"></i>Create`;
      if (hint) hint.textContent = mode === "rename"
        ? "Renaming keeps every item and its progress."
        : "A new, empty checklist is created and selected.";
      if (input) input.value = mode === "rename" && l ? l.name : "";
      const descInput = document.getElementById("checklistDescInput");
      if (descInput) descInput.value = mode === "rename" && l ? (l.description || "") : "";
      setFieldError("checklistNameInput", "checklistNameError", "");
      refreshIcons(document);
      openModal("checklistModal");
    }
    on("newListBtn", () => openChecklistModal("create"));
    on("renameListBtn", () => {
      if (!activeList()) return;
      openChecklistModal("rename");
    });
    on("editListDescBtn", () => {
      if (!activeList()) return;
      openChecklistModal("rename");
    });
    const checklistForm = $("#checklistForm");
    if (checklistForm) checklistForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("checklistNameInput");
      const name = ((input && input.value) || "").trim();
      if (!name) {
        setFieldError("checklistNameInput", "checklistNameError", "Please enter a checklist name — it's required.");
        if (input) input.focus();
        return;
      }
      setFieldError("checklistNameInput", "checklistNameError", "");
      const descInput = document.getElementById("checklistDescInput");
      const description = ((descInput && descInput.value) || "").trim().slice(0, 500);
      if (listModalMode === "rename") {
        const l = activeList();
        if (!l) return;
        if (state.lists.some((x) => x.id !== l.id && x.name.toLowerCase() === name.toLowerCase())) {
          toast("warn", "Name taken", "Another checklist already uses that name.");
          return;
        }
        l.name = name;
        l.description = description;
        persistAndRender({ kind: "edit", text: `Updated checklist ${name}` });
        toast("success", "Checklist updated", name);
      } else {
        if (state.lists.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
          toast("warn", "Name taken", "Another checklist already uses that name.");
          return;
        }
        const nl = Store.makeList(name, []);
        nl.description = description;
        state.lists.push(nl);
        setActive(nl.id);
        state.filter = "all";
        state.query = "";
        const s = document.getElementById("search");
        if (s) s.value = "";
        const t = document.getElementById("topSearch");
        if (t) t.value = "";
        persistAndRender({ kind: "add", text: `Created checklist ${name}` });
        setView("checklist", { hash: true, scroll: false });
        toast("success", "Checklist created", name);
      }
      closeModal("checklistModal");
    });
    const sideLists = $("#sideLists");
    if (sideLists) sideLists.addEventListener("click", (e) => {
      const b = e.target.closest("[data-listid]");
      if (!b) return;
      setActive(b.dataset.listid);
      state.filter = "all";
      setView("checklist");
    });
    on("sidePrev", () => {
      if (state.sidePage > 1) {
        state.sidePage -= 1;
        renderSidebarLists();
      }
    });
    on("sideNext", () => {
      const total = Math.max(1, Math.ceil(state.lists.length / C.SIDE_PAGE_SIZE));
      if (state.sidePage < total) {
        state.sidePage += 1;
        renderSidebarLists();
      }
    });
    const checklistSel = $("#checklistSel");
    if (checklistSel) checklistSel.addEventListener("change", () => {
      setActive(checklistSel.value);
      state.filter = "all";
      render();
    });
    on("deleteListBtn", () => {
      const l = activeList();
      if (!l) return;
      const desc = document.getElementById("deleteListDesc");
      if (desc) desc.innerHTML = `This removes <b>${esc(l.name)}</b> (${l.items.length} items) and its progress from this browser. This cannot be undone.`;
      openModal("deleteListModal");
    });
    on("confirmDeleteList", () => {
      const l = activeList();
      if (!l) return;
      state.lists = state.lists.filter((x) => x.id !== l.id);
      delete state.listState[l.id];
      if (!state.lists.length) state.lists.push(Store.makeList("Untitled checklist", []));
      setActive(state.lists[0].id);
      saveAll();
      Store.pushActivity({ kind: "remove", list: "", text: `Deleted checklist ${l.name}` });
      closeModal("deleteListModal");
      state.filter = "all";
      state.query = "";
      render();
      toast("info", "Checklist deleted", l.name);
    });
    on("confirmDeleteItem", () => {
      const p = pendingItemDelete;
      pendingItemDelete = null;
      if (!p) { closeModal("deleteItemModal"); return; }
      const l = activeList();
      if (!l) { closeModal("deleteItemModal"); return; }
      if (p.type === "subtask") {
        const parent = l.items.find((it) => it.id === p.parentId) || null;
        const sub = parent && Array.isArray(parent.subs) ? parent.subs.find((s) => s.id === p.subId) || null : null;
        if (!parent || !sub) { closeModal("deleteItemModal"); return; }
        parent.subs = parent.subs.filter((s) => s.id !== sub.id);
        setDone(sub.id, false);
        persistAndRender({ kind: "remove", text: `Deleted subtask ${shortName(sub.title)}` });
        toast("info", "Subtask deleted", shortName(sub.title));
      } else {
        const item = l.items.find((it) => it.id === p.taskId) || null;
        if (!item) { closeModal("deleteItemModal"); return; }
        l.items = l.items.filter((it) => it.id !== item.id);
        setDone(item.id, false);
        (item.subs || []).forEach((s) => setDone(s.id, false));
        state.collapsed.delete(item.id);
        persistAndRender({ kind: "remove", text: `Deleted ${shortName(item.title)}` });
        toast("info", "Item deleted", shortName(item.title));
      }
      closeModal("deleteItemModal");
    });

    // ---------- import .txt → new checklist ----------
    // Indented lines (2+ spaces / tab) or "- "/"* " bullets become subtasks.
    // Trailing " #tag" tokens become tags: "Deploy api #urgent #backend".
    function splitImportTags(title) {
      const tags = [];
      const m = String(title || "").match(/(\s+#[A-Za-z0-9_-]+)+$/);
      if (m) {
        m[0].trim().split(/\s+/).forEach((t) => {
          const v = t.slice(1).toLowerCase();
          if (v && !tags.includes(v) && tags.length < 12) tags.push(v);
        });
        title = String(title).slice(0, String(title).length - m[0].length).trim();
      }
      return { title, tags };
    }
    function parseImportLines(text) {
      const groups = [];
      String(text || "").split("\n").forEach((raw) => {
        if (!raw.trim()) return;
        const indent = (raw.match(/^[ \t]*/) || [""])[0].length;
        let title = raw.trim().replace(/^[-*•+]\s+/, "").trim();
        if (!title) return;
        // Strip export timestamps: "2026-01-01 - [Active] - Title #tags"
        title = title.replace(/^\d{4}-\d{2}-\d{2}\s+-\s+\[(?:Completed|Active)\]\s+-\s+/, "").replace(/^└\s*/, "").trim();
        if (!title) return;
        const parsed = splitImportTags(title);
        if (indent > 0 && groups.length) groups[groups.length - 1].subs.push(parsed);
        else groups.push({ title: parsed.title, tags: parsed.tags, subs: [] });
      });
      return groups;
    }
    // ---------- import checklist modal (drag & drop or browse) ----------
    let pendingImport = null; // {groups, fileName}
    let importDest = "new"; // "new" checklist | "active" checklist
    function importGroupsFromText(text, fileName) {
      if (/\.csv$/i.test(fileName || "")) return groupsFromCSV(text);
      return parseImportLines(text);
    }
    function refreshImportModal() {
      const destSeg = document.getElementById("importDestSeg");
      if (destSeg) $$("button", destSeg).forEach((b) => b.classList.toggle("active", b.dataset.dest === importDest));
      const label = document.getElementById("confirmImportLabel");
      if (label) label.textContent = importDest === "active" ? "Add to active list" : "Create checklist";
      const summary = document.getElementById("importSummary");
      if (!summary) return;
      if (!pendingImport) { summary.textContent = "No file selected yet."; return; }
      const g = pendingImport.groups;
      const subs = g.reduce((n, x) => n + (x.subs || []).length, 0);
      const l = activeList();
      summary.textContent = `${pendingImport.fileName}: ${g.length} tasks${subs ? `, ${subs} subtasks` : ""} found — ${importDest === "active" ? `will be added to "${l ? l.name : "active list"}"` : "a new checklist will be created"}.`;
    }
    function setImportError(msg) {
      const err = document.getElementById("importError");
      if (err) {
        err.textContent = msg || "";
        err.classList.toggle("hidden", !msg);
      }
      const dz = document.getElementById("importDropzone");
      if (dz) {
        dz.classList.toggle("attn", !!msg);
        if (msg) setTimeout(() => dz.classList.remove("attn"), 650);
      }
    }
    function openImportModal() {
      pendingImport = null;
      importDest = "new";
      setImportError("");
      const dz = document.getElementById("importDropzone");
      if (dz) dz.classList.remove("drag");
      refreshImportModal();
      refreshIcons(document);
      openModal("importModal");
    }
    function handleImportFile(file) {
      if (!file) return;
      setImportError("");
      const reader = new FileReader();
      reader.onload = () => {
        const groups = importGroupsFromText(String(reader.result || ""), file.name || "");
        if (!groups.length) {
          pendingImport = null;
          refreshImportModal();
          setImportError("That file has no tasks — please choose a file with at least one task.");
          return;
        }
        pendingImport = { groups, fileName: file.name || "dropped file" };
        setImportError("");
        refreshImportModal();
      };
      reader.readAsText(file);
    }
    on("importListBtn", openImportModal);
    on("importBrowseBtn", () => {
      const f = document.getElementById("importFile");
      if (f) f.click();
    });
    const importFile = $("#importFile");
    if (importFile) importFile.addEventListener("change", () => {
      const file = importFile.files && importFile.files[0];
      importFile.value = "";
      handleImportFile(file);
    });
    const importDropzone = $("#importDropzone");
    if (importDropzone) {
      importDropzone.addEventListener("click", (e) => {
        if (e.target.closest && e.target.closest("#importBrowseBtn")) return; // button handles itself
        const f = document.getElementById("importFile");
        if (f) f.click();
      });
      importDropzone.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const f = document.getElementById("importFile");
          if (f) f.click();
        }
      });
      ["dragenter", "dragover"].forEach((ev) => importDropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        importDropzone.classList.add("drag");
      }));
      ["dragleave", "drop"].forEach((ev) => importDropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        importDropzone.classList.remove("drag");
      }));
      importDropzone.addEventListener("drop", (e) => {
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files[0]) handleImportFile(files[0]);
      });
    }
    const importModal = $("#importModal");
    if (importModal) {
      // never navigate away when a file misses the dropzone
      importModal.addEventListener("dragover", (e) => e.preventDefault());
      importModal.addEventListener("drop", (e) => e.preventDefault());
      const seg = document.getElementById("importDestSeg");
      if (seg) seg.addEventListener("click", (e) => {
        const b = e.target.closest && e.target.closest("[data-dest]");
        if (!b) return;
        importDest = b.dataset.dest === "active" ? "active" : "new";
        refreshImportModal();
      });
    }
    on("confirmImportBtn", () => {
      if (!pendingImport || !pendingImport.groups.length) {
        setImportError("Please choose a file first — drag & drop a .txt or .csv file above, or click Browse files.");
        toast("warn", "No file selected", "Please import a file first.");
        return;
      }
      const { groups, fileName } = pendingImport;
      if (importDest === "active") {
        pendingImport = null;
        closeModal("importModal");
        addImportedGroups(groups, fileName);
        return;
      }
      const subCount = groups.reduce((n, g) => n + (g.subs || []).length, 0);
      let base = (fileName || "Imported checklist").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Imported checklist";
      let name = base, i = 2;
      while (state.lists.some((x) => x.name.toLowerCase() === name.toLowerCase())) name = `${base} (${i++})`;
      const nl = Store.makeList(name, groups);
      state.lists.push(nl);
      setActive(nl.id);
      state.filter = "all";
      state.query = "";
      persistAndRender({ kind: "add", text: `Imported checklist ${name} (${groups.length} items${subCount ? `, ${subCount} subtasks` : ""})` });
      pendingImport = null;
      closeModal("importModal");
      setView("checklist", { hash: true, scroll: false });
      toast("success", "Checklist imported", `${name} · ${groups.length} items${subCount ? ` · ${subCount} subtasks` : ""}`);
    });

    // ---------- export active checklist as standalone HTML ----------
    on("exportHtmlBtn", () => {
      const l = activeList();
      if (!l) return;
      if (!window.ChecklistExport) { toast("warn", "Exporter unavailable", "assets/js/export-html.js failed to load."); return; }
      const rows = sortRows(allItems()).map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description || "",
        tags: r.tags || [],
        createdAt: r.createdAt,
        subs: (r.subs || []).map((s) => ({ id: s.id, title: s.title, description: s.description || "", tags: s.tags || [], createdAt: s.createdAt })),
      }));
      const m = state.listState[l.id] || {};
      const date = todayStr();
      const html = window.ChecklistExport.build(l.name, l.id, rows, { date, description: l.description || "" });
      window.ChecklistExport.download(window.ChecklistExport.filename(l.name, date), html);
      Store.pushActivity({ kind: "bulk", list: l.name, text: `Exported standalone HTML (${rows.length} items)` });
      render();
      toast("success", "Standalone HTML exported", `${rows.length} items · no sidebar, works offline`);
    });

    // modal close wiring
    $$("[data-close]").forEach((b) => b.addEventListener("click", () => closeModal(b.dataset.close)));
    $$(".modal-back").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) closeModal(m.id); }));
    const deleteItemModalEl = document.getElementById("deleteItemModal");
    if (deleteItemModalEl) deleteItemModalEl.addEventListener("click", (e) => {
      if (e.target === deleteItemModalEl || (e.target.closest && e.target.closest("[data-close]"))) pendingItemDelete = null;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        $$(".modal-back.open").forEach((m) => closeModal(m.id));
        pendingItemDelete = null;
        document.body.classList.remove("nav-open");
      }
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        (search || topSearch)?.focus();
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        (search || topSearch)?.focus();
      } else if (e.key === "[" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        document.getElementById("railToggle")?.click();
      }
    });

    // notifications / shortcuts demo
    on("bellBtn", () => {
      const l = activeList();
      const pending = allItems().filter((r) => !effDone(r)).length;
      toast("info", `${pending} items pending${l ? ` · ${l.name}` : ""}`, pending ? "Newest items surface first in Newest-first sort." : "List fully completed.");
    });
    on("shortcutsBtn", () => openModal("shortcutsModal"));
    on("recentViewAll", () => setView("activity"));
    const anaLists = $("#anaLists");
    if (anaLists) anaLists.addEventListener("click", (e) => {
      const b = e.target.closest("[data-analist]");
      if (!b) return;
      setActive(b.dataset.analist);
      state.filter = "all";
      setView("checklist");
    });

    // activity: clear log + pagination (5 per page)
    on("clearActivityBtn", () => {
      Store.clearActivity();
      state.apage = 1;
      render();
      toast("info", "Activity log cleared");
    });
    on("actPrev", () => gotoActPage(state.apage - 1));
    on("actNext", () => gotoActPage(state.apage + 1));
    const actNums = $("#actPageNumbers");
    if (actNums) actNums.addEventListener("click", (e) => {
      const b = e.target.closest("[data-apage]");
      if (b) gotoActPage(parseInt(b.dataset.apage, 10) || 1);
    });
    const actSizeSel = $("#actPageSizeSel");
    if (actSizeSel) {
      actSizeSel.value = String(state.apageSize);
      actSizeSel.addEventListener("change", () => {
        state.apageSize = parseInt(actSizeSel.value, 10) || 0;
        if (Number.isNaN(state.apageSize)) state.apageSize = 8;
        Store.setActPageSize(state.apageSize);
        state.apage = 1;
        render();
      });
    }

    // settings: appearance
    const themeSeg = $("#setThemeSeg");
    if (themeSeg) themeSeg.addEventListener("click", (e) => {
      const b = e.target.closest("[data-settheme]");
      if (!b) return;
      applyTheme(b.dataset.settheme);
    });
    const densSeg = $("#setDensitySeg");
    if (densSeg) densSeg.addEventListener("click", (e) => {
      const b = e.target.closest("[data-setdensity]");
      if (!b || b.dataset.setdensity === state.density) return;
      state.density = b.dataset.setdensity;
      Store.setDensity(state.density);
      render();
    });
    const setSort = $("#setSortSel");
    if (setSort) setSort.addEventListener("change", () => {
      state.sort = setSort.value; Store.setSort(state.sort); state.page = 1; render();
    });
    const setSize = $("#setPageSizeSel");
    if (setSize) setSize.addEventListener("change", () => {
      state.pageSize = parseInt(setSize.value, 10) || 0;
      Store.setPageSize(state.pageSize); state.page = 1; render();
    });
    on("setExportBtn", doExportTxt);
    on("setCopyBtn", doCopyList);
    on("setClearStatusBtn", openClearModal);
    on("setDeleteListBtn", () => document.getElementById("deleteListBtn")?.click());

    // ---------- full localStorage backup → device, restore ← device ----------
    function backupKeys() {
      return [
        C.LISTS_KEY, C.LIST_STATE_KEY, C.ACTIVE_LIST_KEY, C.ACTIVITY_KEY,
        C.THEME_KEY, C.DENSITY_KEY, C.SORT_KEY, C.PAGE_SIZE_KEY,
        C.ACT_PAGE_SIZE_KEY, C.SIDEBAR_KEY, C.COLLAPSED_KEY,
        C.CUSTOM_KEY, C.STORAGE_KEY,
      ];
    }
    function doBackup() {
      const data = {};
      backupKeys().forEach((k) => {
        try {
          const raw = localStorage.getItem(k);
          data[k] = raw === null ? null : JSON.parse(raw);
        } catch { data[k] = null; }
      });
      const payload = { app: "checklists", kind: "localstorage-backup", version: 1, exportedAt: new Date().toISOString(), data };
      download(`checklist-backup-${todayStr()}.json`, JSON.stringify(payload, null, 2), "application/json");
      Store.pushActivity({ kind: "bulk", text: "Downloaded full data backup" });
      render();
      toast("success", "Backup downloaded", `${state.lists.length} lists · restore anytime from Settings`);
    }
    on("backupBtn", doBackup);
    let pendingRestore = null;
    on("restoreBtn", () => {
      const f = document.getElementById("restoreFile");
      if (f) f.click();
    });
    const restoreFile = $("#restoreFile");
    if (restoreFile) restoreFile.addEventListener("change", () => {
      const file = restoreFile.files && restoreFile.files[0];
      restoreFile.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        pendingRestore = null;
        let payload = null;
        try { payload = JSON.parse(reader.result); }
        catch { toast("warn", "Invalid backup", "That file is not valid JSON."); return; }
        const data = payload && payload.data;
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          toast("warn", "Invalid backup", "That file is not a Checklists backup.");
          return;
        }
        const lists = data[C.LISTS_KEY];
        if (!Array.isArray(lists)) {
          toast("warn", "Invalid backup", "No checklists found in that file.");
          return;
        }
        pendingRestore = data;
        const desc = document.getElementById("restoreDesc");
        if (desc) desc.innerHTML = `<b>${esc(file.name)}</b> holds <b>${lists.length} checklist${lists.length === 1 ? "" : "s"}</b>${payload.exportedAt ? ` (exported ${esc(String(payload.exportedAt).slice(0, 10))})` : ""}. Restoring replaces <b>all</b> local data in this browser. This cannot be undone.`;
        openModal("restoreModal");
      };
      reader.readAsText(file);
    });
    on("confirmRestore", () => {
      if (!pendingRestore) { closeModal("restoreModal"); return; }
      try {
        backupKeys().forEach((k) => {
          if (!(k in pendingRestore)) return;
          const v = pendingRestore[k];
          if (v === null || v === undefined) localStorage.removeItem(k);
          else localStorage.setItem(k, JSON.stringify(v));
        });
      } catch {
        toast("warn", "Restore failed", "Browser storage is unavailable.");
        return;
      }
      pendingRestore = null;
      closeModal("restoreModal");
      location.reload();
    });

    // pagination controls
    on("prevPage", () => gotoPage(state.page - 1, true));
    on("nextPage", () => gotoPage(state.page + 1, true));
    const nums = $("#pageNumbers");
    if (nums) nums.addEventListener("click", (e) => {
      const b = e.target.closest("[data-page]");
      if (b) gotoPage(parseInt(b.dataset.page, 10) || 1, true);
    });
    const sizeSel = $("#pageSizeSel");
    if (sizeSel) {
      sizeSel.value = String(state.pageSize);
      sizeSel.addEventListener("change", () => {
        state.pageSize = parseInt(sizeSel.value, 10) || 0;
        Store.setPageSize(state.pageSize);
        state.page = 1;
        render();
      });
    }

    // sidebar icon-rail collapse / expand (persisted, single bottom toggle)
    const applySidebar = (collapsed) => {
      document.body.classList.toggle("side-collapsed", !!collapsed);
      Store.setSidebarCollapsed(!!collapsed);
      const t = $("#railToggle");
      if (t) {
        t.innerHTML = `<i data-lucide="${collapsed ? "panel-left-open" : "panel-left-close"}"></i><span>${collapsed ? "Expand" : "Collapse"}</span>`;
        t.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
        t.title = `${t.getAttribute("aria-label")} ( [ )`;
      }
      refreshIcons(document);
    };
    applySidebar(Store.isSidebarCollapsed());
    const toggleSidebar = () => applySidebar(!document.body.classList.contains("side-collapsed"));
    on("railToggle", toggleSidebar);
    // mobile / tablet drawer opener (topbar hamburger, ≤900px only)
    on("menuBtn", () => document.body.classList.toggle("nav-open"));
    // brand logo → reload the page to root (overview)
    const brand = document.querySelector(".brand");
    if (brand) {
      brand.classList.add("brand-clickable");
      brand.setAttribute("role", "button");
      brand.setAttribute("tabindex", "0");
      brand.setAttribute("title", "Back to overview");
      brand.setAttribute("aria-label", "Back to overview");
      brand.addEventListener("click", goRoot);
      brand.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goRoot(); }
      });
    }

    // back to top
    const toTop = $("#toTopBtn");
    const onScroll = () => {
      if (toTop) toTop.classList.toggle("show", window.scrollY > 400);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    if (toTop) toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.add("open");
    const input = m.querySelector("input[type='text']");
    if (input) setTimeout(() => input.focus(), 60);
  }
  function closeModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove("open");
  }

  // ---------- boot ----------
  async function boot() {
    // Dynamic skeleton: shimmer ONLY if the fetch is actually slow.
    // Fast (cached/local) loads render instantly with no skeleton flash.
    // Nav clicks never touch this — they render sync local data instantly.
    const SLOW_MS = 250;
    let skeletonShown = false;
    let slowTimer = null;
    if (!REDUCED_MOTION) {
      slowTimer = setTimeout(() => {
        skeletonShown = true;
        document.body.classList.add("is-booting");
      }, SLOW_MS);
    }
    // Sample .txt is reference data: it seeds ONE sample checklist on
    // first run (migrating any legacy single-list progress onto it).
    let seedTitles = [...Store.FALLBACK_ITEMS];
    try {
      const live = await Store.loadItems();
      if (live && live.length) seedTitles = [...new Set(live)];
    } catch {}
    if (slowTimer) clearTimeout(slowTimer);
    const bootData = Store.ensureSeedLists(seedTitles);
    state.lists = bootData.lists;
    state.listState = bootData.state;
    state.activeId = bootData.activeId;
    wire();
    // version labels
    $$("[data-version]").forEach((el) => (el.textContent = "v" + C.APP_VERSION));
    try { localStorage.removeItem("checklist-sidebar"); } catch {} // v1 key retired (v2 defaults expanded)
    setView(viewFromHash(), { hash: false, scroll: false }); // initial view from #/… (no hash rewrite)
    refreshIcons(document);
    render();
    refreshIcons(document);
    // Fade the full-screen loader immediately when data is ready. Only
    // pause briefly if the skeleton actually showed (avoids flicker).
    document.body.classList.add("boot-done");
    setTimeout(() => {
      const b = document.getElementById("boot");
      if (b) b.remove();
    }, 600);
    if (skeletonShown && !REDUCED_MOTION) await new Promise((r) => setTimeout(r, 200));
    document.body.classList.remove("is-booting");
    // Single celebratory reveal (KPI count-up, donut fill, row stagger,
    // entrance) — plays once on boot, never on nav clicks.
    state.bootAnim = true;
    render();
    playEntrance();
    state.bootAnim = false;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
