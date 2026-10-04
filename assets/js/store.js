/* Checklist Ops Console — store layer (localStorage persistence). */
(function (global) {
  "use strict";
  const C = () => global.ChecklistConfig;

  const FALLBACK_ITEMS = [
    "Plan weekly priorities",
    "Review open pull requests",
    "Update project documentation",
    "Prepare demo for stakeholders",
    "Reply to pending emails",
    "Schedule team retrospective",
    "Back up important files",
    "Draft monthly report",
    "Organize shared drive",
    "Follow up with designer",
    "Test the new release build",
    "Share meeting notes",
  ];

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      const v = JSON.parse(raw);
      return v ?? fallback;
    } catch {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  const Store = {
    FALLBACK_ITEMS,
    loadStatus() { return readJSON(C().STORAGE_KEY, {}); },
    saveStatus(s) { writeJSON(C().STORAGE_KEY, s); },
    loadCustom() {
      const v = readJSON(C().CUSTOM_KEY, []);
      if (!Array.isArray(v)) return [];
      // Normalise: legacy entries are plain strings; current entries are {title, createdAt}.
      return v
        .map((x) => {
          if (typeof x === "string" && x.trim()) return { title: x.trim(), createdAt: null };
          if (x && typeof x.title === "string" && x.title.trim()) {
            return {
              title: x.title.trim(),
              createdAt: typeof x.createdAt === "number" ? x.createdAt : null,
            };
          }
          return null;
        })
        .filter(Boolean);
    },
    saveCustom(list) {
      const clean = (Array.isArray(list) ? list : [])
        .map((x) => {
          if (typeof x === "string" && x.trim()) return { title: x.trim(), createdAt: Date.now() };
          if (x && typeof x.title === "string" && x.title.trim()) {
            return {
              title: x.title.trim(),
              createdAt: typeof x.createdAt === "number" ? x.createdAt : Date.now(),
            };
          }
          return null;
        })
        .filter(Boolean);
      writeJSON(C().CUSTOM_KEY, clean);
    },
    loadActivity() {
      const v = readJSON(C().ACTIVITY_KEY, []);
      return Array.isArray(v) ? v.slice(0, 50) : [];
    },
    pushActivity(entry) {
      const log = Store.loadActivity();
      log.unshift({ t: Date.now(), ...entry });
      writeJSON(C().ACTIVITY_KEY, log.slice(0, 50));
    },
    clearActivity() { try { localStorage.removeItem(C().ACTIVITY_KEY); } catch {} },
    clearCustom() { try { localStorage.removeItem(C().CUSTOM_KEY); } catch {} },
    getTheme() { return localStorage.getItem(C().THEME_KEY) || "dark"; },
    setTheme(t) { try { localStorage.setItem(C().THEME_KEY, t); } catch {} },
    getDensity() { return localStorage.getItem(C().DENSITY_KEY) || "comfortable"; },
    setDensity(d) { try { localStorage.setItem(C().DENSITY_KEY, d); } catch {} },
    getSort() {
      const s = localStorage.getItem(C().SORT_KEY) || "newest";
      return s === "default" ? "newest" : s; // legacy value → newest-first
    },
    setSort(s) { try { localStorage.setItem(C().SORT_KEY, s); } catch {} },
    getPageSize() {
      const raw = localStorage.getItem(C().PAGE_SIZE_KEY);
      const n = parseInt(raw, 10);
      if (n === 0) return 0; // 0 = show all
      if ([5, 8, 10, 12, 15, 20, 50].includes(n)) return n;
      return 10;
    },
    setPageSize(n) { try { localStorage.setItem(C().PAGE_SIZE_KEY, String(n)); } catch {} },
    getActPageSize() {
      const raw = localStorage.getItem(C().ACT_PAGE_SIZE_KEY);
      const n = parseInt(raw, 10);
      if (n === 0) return 0; // 0 = show all
      if ([5, 8, 10, 15, 20, 50].includes(n)) return n;
      return 8;
    },
    setActPageSize(n) { try { localStorage.setItem(C().ACT_PAGE_SIZE_KEY, String(n)); } catch {} },
    isSidebarCollapsed() { try { return localStorage.getItem(C().SIDEBAR_KEY) === "1"; } catch { return false; } },
    setSidebarCollapsed(collapsed) { try { localStorage.setItem(C().SIDEBAR_KEY, collapsed ? "1" : "0"); } catch {} },

    // ---------- multiple checklists ----------
    // List: {id, name, description, createdAt, updatedAt, items: [{id, title, description, tags, createdAt, subs: [{id, title, description, tags, createdAt}]}]}
    // ListState: {[listId]: {[itemId|subId]: true}}
    uid(prefix) {
      return (prefix || "id") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    },
    cleanDesc(v) {
      return typeof v === "string" ? v.trim().slice(0, 2000) : "";
    },
    cleanTags(v) {
      const src = Array.isArray(v) ? v : String(v || "").split(",");
      const seen = new Set();
      const out = [];
      src.forEach((t) => {
        const s = String(t || "").trim().replace(/^#+/, "").toLowerCase().slice(0, 30);
        if (s && !seen.has(s) && out.length < 12) { seen.add(s); out.push(s); }
      });
      return out;
    },
    cleanSub(s) {
      if (!s || typeof s.title !== "string" || !s.title.trim()) return null;
      return {
        id: typeof s.id === "string" && s.id ? s.id : Store.uid("s"),
        title: s.title.trim(),
        description: Store.cleanDesc(s.description),
        tags: Store.cleanTags(s.tags),
        createdAt: typeof s.createdAt === "number" ? s.createdAt : Date.now(),
      };
    },
    cleanItem(it) {
      if (typeof it === "string" && it.trim()) {
        return { id: Store.uid("i"), title: it.trim(), description: "", tags: [], createdAt: Date.now(), subs: [] };
      }
      if (it && typeof it.title === "string" && it.title.trim()) {
        return {
          id: typeof it.id === "string" && it.id ? it.id : Store.uid("i"),
          title: it.title.trim(),
          description: Store.cleanDesc(it.description),
          tags: Store.cleanTags(it.tags),
          createdAt: typeof it.createdAt === "number" ? it.createdAt : Date.now(),
          subs: Array.isArray(it.subs) ? it.subs.map(Store.cleanSub).filter(Boolean) : [],
        };
      }
      return null;
    },
    loadLists() {
      const v = readJSON(C().LISTS_KEY, null);
      if (!Array.isArray(v) || !v.length) return null;
      const clean = v
        .map((l) => {
          if (!l || typeof l.name !== "string") return null;
          const items = Array.isArray(l.items)
            ? l.items.map(Store.cleanItem).filter(Boolean)
            : [];
          return {
            id: typeof l.id === "string" && l.id ? l.id : Store.uid("l"),
            name: l.name.trim() || "Untitled checklist",
            description: Store.cleanDesc(l.description),
            createdAt: typeof l.createdAt === "number" ? l.createdAt : Date.now(),
            updatedAt: typeof l.updatedAt === "number" ? l.updatedAt : Date.now(),
            items,
          };
        })
        .filter(Boolean);
      return clean.length ? clean : null;
    },
    saveLists(lists) { writeJSON(C().LISTS_KEY, lists); },
    loadListState() {
      const v = readJSON(C().LIST_STATE_KEY, {});
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    },
    saveListState(s) { writeJSON(C().LIST_STATE_KEY, s); },
    getActiveId() { try { return localStorage.getItem(C().ACTIVE_LIST_KEY); } catch { return null; } },
    setActiveId(id) { try { localStorage.setItem(C().ACTIVE_LIST_KEY, id); } catch {} },
    makeList(name, titles, description) {
      const now = Date.now();
      const mkSub = (st, j, base) => {
        if (st && typeof st === "object" && typeof st.title === "string") {
          return { id: Store.uid("s"), title: String(st.title), description: Store.cleanDesc(st.description), tags: Store.cleanTags(st.tags), createdAt: base + j };
        }
        return { id: Store.uid("s"), title: String(st), description: "", tags: [], createdAt: base + j };
      };
      return {
        id: Store.uid("l"),
        name: (name || "").trim() || "Untitled checklist",
        description: Store.cleanDesc(description),
        createdAt: now,
        updatedAt: now,
        items: (titles || []).map((t, i) => (
          typeof t === "object" && t !== null && Array.isArray(t.subs)
            ? { id: Store.uid("i"), title: String(t.title), description: Store.cleanDesc(t.description), tags: Store.cleanTags(t.tags), createdAt: now + i, subs: t.subs.map((st, j) => mkSub(st, j, now + i * 1000)) }
            : typeof t === "object" && t !== null && typeof t.title === "string"
              ? { id: Store.uid("i"), title: String(t.title), description: Store.cleanDesc(t.description), tags: Store.cleanTags(t.tags), createdAt: now + i, subs: [] }
              : { id: Store.uid("i"), title: String(t), description: "", tags: [], createdAt: now + i, subs: [] }
        )),
      };
    },
    getCollapsedIds() {
      try {
        const v = JSON.parse(localStorage.getItem(C().COLLAPSED_KEY));
        return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
      } catch { return []; }
    },
    setCollapsedIds(ids) { try { localStorage.setItem(C().COLLAPSED_KEY, JSON.stringify(ids)); } catch {} },
    // First-run bootstrap + one-time migration from the legacy single-list
    // keys (checklist-status-v1 titles + checklist-custom-v1). The sample
    // .txt content is reference data only — it seeds ONE sample checklist
    // the user can rename, edit or delete.
    ensureSeedLists(seedTitles) {
      let lists = Store.loadLists();
      let state = Store.loadListState();
      if (lists) {
        let activeId = Store.getActiveId();
        if (!lists.some((l) => l.id === activeId)) {
          activeId = lists[0].id;
          Store.setActiveId(activeId);
        }
        return { lists, state, activeId };
      }
      const now = Date.now();
      const sample = {
        id: Store.uid("l"),
        name: "Sample Checklist",
        description: "",
        createdAt: now,
        updatedAt: now,
        items: (seedTitles || []).map((t, i) => ({ id: Store.uid("i"), title: t, description: "", tags: [], createdAt: now + i, subs: [] })),
      };
      // Migrate legacy progress flags (keyed by title) onto the new ids.
      const legacyStatus = Store.loadStatus();
      const legacyCustom = Store.loadCustom();
      const sampleState = {};
      sample.items.forEach((it) => {
        if (legacyStatus[it.title]) sampleState[it.id] = true;
      });
      legacyCustom.forEach((c, j) => {
        const item = { id: Store.uid("i"), title: c.title, description: "", tags: [], createdAt: now + sample.items.length + j, subs: [] };
        sample.items.push(item);
        if (legacyStatus[c.title]) sampleState[item.id] = true;
      });
      lists = [sample];
      state = { [sample.id]: sampleState };
      Store.saveLists(lists);
      Store.saveListState(state);
      Store.setActiveId(sample.id);
      return { lists, state, activeId: sample.id };
    },

    async loadItems() {
      for (const url of C().DATA_URLS) {
        try {
          const r = await fetch(url, { cache: "no-store" });
          if (!r.ok) continue;
          const text = await r.text();
          const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
          if (lines.length) return lines;
        } catch {
          /* try next (file:// will fail — fallback is fine) */
        }
      }
      return [...FALLBACK_ITEMS];
    },
  };

  global.ChecklistStore = Store;
})(window);
