// Portable checklist web app.
// Storage: localStorage["checklist-status-v1"] = { "<item text>": true/false }
// Data source: ./checklist-items.txt (fetch) with embedded fallback for file://
// Compatible export format with todo_checklist: `YYYY-MM-DD - [Completed|Active] - title`

const STORAGE_KEY = "checklist-status-v1";
const THEME_KEY = "checklist-theme";

const FALLBACK_ITEMS = [
  "Cloud-luckey-draw-anniversary-cdn-frontend-points",
  "Cloud-Login-Service - 52.66.241.149",
  "NDC-EXT/INT-LB - 10.68.2.28-29, 10.68.2.26-26",
  "Remote.esewa.com.np - By NOC TEAM",
  "DR-K8S LB - 10.150.160.30 and 10.150.160.31",
  "NDC INT LB - 10.68.2.25 and 10.68.2.26",
  "NDC EXT LB and NDC INT LB - 10.68.2.28 and 10.68.2.29",
  "Corporate eSewa v2 - 10.68.5.25 10.68.5.26",
  "Corporate eSewa V1 - 10.13.222.219",
  "eSewa Harbor - 10.13.212.35 and 10.13.213.122",
  "Reporting-API - 10.68.4.63",
  "K3S-v4-IR - TLS",
  "IR-LB - 10.13.222.205",
  "Admin - 10.13.222.114 10.13.222.128 10.13.121.33",
  "Ext-LB - 10.13.222.22 - 10.13.222.23",
  "Kyc-Automation - 10.68.2.35",
  "Foneloan - 10.71.227.23",
  "Movies-SDK-LB2 - 10.68.2.65",
  "Movies-SDK-LB1 - 10.68.2.64",
  "Jbbl-UPI - 10.13.222.4",
  "NS-IR - 10.13.222.206",
  "Links-eSewa - 10.13.222.28",
  "SS - 10.13.222.220",
  "PNR-cloud2 - 13.229.152.18",
  "PNR-cloud1 - 47.130.4.114",
  "SDK-MW-LB - 10.13.222.75",
  "DC-CDN Server - 10.13.222.102",
  "KYC-Server - 10.13.222.103",
  "NDC-CDN - 10.68.2.71",
  "Cloud-PNR",
  "Audiqr-10.17.222.10",
];

let items = [...FALLBACK_ITEMS];

const listEl = document.getElementById("checklist");
const progressText = document.getElementById("progressText");
const progressBar = document.getElementById("progressBar");
const searchEl = document.getElementById("search");
const emptyMsg = document.getElementById("emptyMsg");
const countLabel = document.getElementById("countLabel");

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function keyFor(text) {
  return text;
}

function updateProgress() {
  const state = loadState();
  const checked = items.filter((t) => state[keyFor(t)]).length;
  const pct = items.length ? Math.round((checked / items.length) * 100) : 0;
  progressText.textContent = `${checked} / ${items.length} checked (${pct}%)`;
  progressBar.style.width = `${pct}%`;
  countLabel.textContent = `${items.length} items`;
}

function render(filter = "") {
  const state = loadState();
  listEl.innerHTML = "";
  let visible = 0;

  items.forEach((text) => {
    if (filter && !text.toLowerCase().includes(filter.toLowerCase())) return;
    visible += 1;
    const key = keyFor(text);
    const li = document.createElement("li");
    if (state[key]) li.classList.add("checked");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!state[key];
    cb.setAttribute("aria-label", text);
    cb.addEventListener("change", () => {
      const s = loadState();
      s[key] = cb.checked;
      saveState(s);
      li.classList.toggle("checked", cb.checked);
      updateProgress();
    });

    const label = document.createElement("label");
    label.textContent = text;
    label.addEventListener("click", () => {
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change"));
    });

    li.append(cb, label);
    listEl.appendChild(li);
  });

  emptyMsg.classList.toggle("hidden", visible !== 0);
  updateProgress();
}

function download(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Same line format as todo_checklist's per-checklist export.
function toExportTxt() {
  const state = loadState();
  const date = new Date().toISOString().split("T")[0];
  const sorted = [...items].sort((a, b) => {
    const ca = !!state[keyFor(a)];
    const cb = !!state[keyFor(b)];
    if (ca !== cb) return ca ? -1 : 1;
    return a.localeCompare(b);
  });
  return sorted
    .map((t) => `${date} - [${state[keyFor(t)] ? "Completed" : "Active"}] - ${t}`)
    .join("\n");
}

// --- wiring ---
document.getElementById("checkAllBtn").addEventListener("click", () => {
  const s = {};
  items.forEach((t) => (s[keyFor(t)] = true));
  saveState(s);
  render(searchEl.value);
});

document.getElementById("uncheckAllBtn").addEventListener("click", () => {
  saveState({});
  render(searchEl.value);
});

document.getElementById("clearBtn").addEventListener("click", () => {
  if (!confirm("Clear all saved checklist data from this browser?")) return;
  localStorage.removeItem(STORAGE_KEY);
  render(searchEl.value);
});

document.getElementById("exportTxtBtn").addEventListener("click", () => {
  const date = new Date().toISOString().split("T")[0];
  download(`checklist-${date}.txt`, toExportTxt());
});

document.getElementById("copyBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(toExportTxt());
    alert("Checklist copied to clipboard");
  } catch {
    alert("Clipboard copy failed — use Export instead");
  }
});

searchEl.addEventListener("input", () => render(searchEl.value));

// theme (persisted separately from checklist data)
const themeBtn = document.getElementById("themeBtn");
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(THEME_KEY, t);
  themeBtn.textContent = t === "dark" ? "☀️" : "🌙";
}
themeBtn.addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});
applyTheme(localStorage.getItem(THEME_KEY) || "light");

// Load live items when served over http(s); fallback keeps file:// working.
fetch("checklist-items.txt")
  .then((r) => {
    if (!r.ok) throw new Error("no txt");
    return r.text();
  })
  .then((t) => {
    const lines = t.split("\n").map((s) => s.trim()).filter(Boolean);
    if (lines.length) items = lines;
  })
  .catch(() => {})
  .finally(() => render());
