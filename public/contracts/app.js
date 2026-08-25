// When the contract maker runs behind the merged nginx setup at
// http://localhost/contracts/, requests should go to /contracts/api so the
// reverse proxy can forward them to FastAPI. When it runs standalone (e.g. by
// opening index.html directly during dev), fall back to the FastAPI ports.
//
// Detection rule: if the page is being served through HTTP from any host
// (i.e. window.location.protocol === "http:" or "https:"), prefer the
// same-origin /contracts/api base. file:// pages keep the direct-port list.
// 2026-05-17 — DO NOT use the Vercel proxy path (`/contracts/api/...`).
// Vercel's rewrite to external destinations strips the Authorization
// header, which makes every authenticated request return 401 "Not
// authenticated" even when the client sends a valid Bearer token.
// Calling Render directly works because the backend's CORS config
// explicitly allows the Vercel origin + Authorization header.
const PROXIED_API_BASE = "https://aq-backend-1.onrender.com";

// Scrub any stale override that earlier troubleshooting may have stored
// (e.g. localhost ports, stale Vercel paths). The default above is the
// only correct value for production.
try { localStorage.removeItem("aq_api_base"); } catch {}
const DIRECT_API_CANDIDATES = [
  "http://127.0.0.1:8001",
  "http://127.0.0.1:8000",
  "http://localhost:8001",
  "http://localhost:8000",
];

const isHttpServed = typeof window !== "undefined"
  && window.location && (window.location.protocol === "http:" || window.location.protocol === "https:");

const API_CANDIDATES = isHttpServed
  ? [PROXIED_API_BASE, ...DIRECT_API_CANDIDATES]
  : DIRECT_API_CANDIDATES;

const savedApiBase = localStorage.getItem("aq_api_base") || "";
let API_BASE = savedApiBase || API_CANDIDATES[0];
// Old saved values pinned to :8000 should be ignored once we are on the
// merged origin — they would bypass the reverse proxy.
if (isHttpServed && savedApiBase && savedApiBase.includes(":8000")) {
  API_BASE = PROXIED_API_BASE;
}

const TEMPLATE_OPTIONS = [
  ["after_pay", "After Pay"],
  ["pre_pay", "Pre Pay"],
  ["savola", "Savola"],
  ["pre_savola", "Pre Savola"],
  ["crispy", "Crispy"],
  ["santia", "Santia"],
  ["free_lancer", "Freelancer"],
];

const STATUSES = [
  "NEW",
  "IN PROGRESS",
  "SIGNED",
  "SENT TO VENDOR",
  "COMPLETED",
  "DONE",
  "DELIVERED",
  "ON HOLD",
  "CANCELLED",
  "PAYMENT PENDING",
  "DRAFT",
];

const PLATFORM_OPTIONS = [
  { key: "tiktok", label: "تيك توك" },
  { key: "instagram", label: "إنستغرام" },
  { key: "snapchat", label: "سناب شات" },
  { key: "youtube", label: "يوتيوب" },
  { key: "kick", label: "كيك" },
];

// ─── Input sanitisation ─────────────────────────────────────────────────────
// Strip HTML/script tags from any user-supplied string before sending it
// to the backend. Prevents stored-XSS if a value is later rendered in
// another view or exported to a document.
function safeText(str) {
  if (typeof str !== "string") return str;
  return str.replace(/<[^>]*>/g, "").trim();
}

// ─── Skeleton loading placeholders ──────────────────────────────────────────
// Show shimmer placeholders while data loads, preventing white-page flash.
function skeletonCards(count = 3) {
  return Array.from({ length: count }, () =>
    `<div class="skeleton skeleton-card"></div>`
  ).join("");
}
function skeletonLines(count = 4) {
  const widths = ["long", "medium", "short", "long", "medium"];
  return Array.from({ length: count }, (_, i) =>
    `<div class="skeleton skeleton-line ${widths[i % widths.length]}"></div>`
  ).join("");
}
function skeletonRows(count = 3) {
  return Array.from({ length: count }, () =>
    `<div class="skeleton-row">
       <div class="skeleton skeleton-card" style="height:80px"></div>
       <div class="skeleton skeleton-card" style="height:80px"></div>
       <div class="skeleton skeleton-card" style="height:80px"></div>
     </div>`
  ).join("");
}

// Token may live in localStorage (remember me) or sessionStorage (this tab only).
// Always check both so a refresh in either mode keeps you signed in.
function readStoredToken() {
  try {
    return (
      localStorage.getItem("aq_token") ||
      sessionStorage.getItem("aq_token") ||
      ""
    );
  } catch {
    return "";
  }
}
function storeToken(token, remember) {
  try {
    if (remember) {
      localStorage.setItem("aq_token", token);
      sessionStorage.removeItem("aq_token");
    } else {
      sessionStorage.setItem("aq_token", token);
      localStorage.removeItem("aq_token");
    }
  } catch {}
}
function clearStoredToken() {
  try { localStorage.removeItem("aq_token"); } catch {}
  try { sessionStorage.removeItem("aq_token"); } catch {}
}

const state = {
  token: readStoredToken(),
  user: null,
  view: localStorage.getItem("aq_view") || "dashboard",
  selectedTaskId: localStorage.getItem("aq_selected_task") || "",
  tasks: [],
  subtasks: [],
  vendors: [],
  vendorCategories: [],
  templates: [],
  contracts: [],
  settings: [],
  users: [],
  audit: [],
  backups: [],
  invites: [],
  pendingInviteFromUrl: null,  // populated on page load from ?invite=TOKEN
  pendingVendors: [],
  pendingClients: [],
  expiryAlerts: [],
  clients: [],
  clientBrands: [],
  selectedClientId: localStorage.getItem("aq_selected_client") || "",
  clientSearch: "",
  clientMode: false,
  search: "",
  taskLimit: Number(localStorage.getItem("aq_task_limit") || 10),
  vendorSearch: "",
  contractSearch: "",
  selectedVendorId: localStorage.getItem("aq_selected_vendor") || "",
  selectedVendorLicense: "",
  // Subtask IDs the user has checked in the Tasks view; cleared whenever
  // the selected task changes.
  selectedSubtaskIds: new Set(),
  selectedBankId: "",
  pendingRequests: 0,
  // ── Design C vendor editor modal state ─────────────────────────
  // The full-screen popup replaces the old #vendor-edit-form +
  // #bank-edit-form side panels. The vendor object being edited
  // (null = create flow). The active tab is either { type: 'id' }
  // for the License/ID document tab, or { type: 'bank', localKey }
  // for a bank tab. Bank drafts are kept in state so we can batch
  // create/update/delete on save without one-at-a-time round-trips.
  // ── Add-many-vendors modal ─────────────────────────────────────
  // The PM app books ten influencers in one go and names them later;
  // this is the same idea for the vendor register. Placeholders are
  // created with a name and a category and nothing else, then filled
  // in from the directory as the details arrive.
  bulkVendorOpen: false,
  bulkVendorBusy: false,
  bulkVendorError: "",
  bulkVendorDone: 0,
  bulkVendorTotal: 0,
  bulkVendorFailed: [],
  vendorEditorOpen: false,
  vendorEditorTarget: null,
  vendorEditorTab: { type: "id" },
  vendorEditorBanks: [],        // BankDraft[]
  vendorEditorSaving: false,
  vendorEditorError: "",
  /** Cached top-field values. Repopulated from the DOM before every
   *  re-render caused by a tab-switch / add bank / remove bank so the
   *  user doesn't lose typed text. Cleared on close. */
  vendorEditorDraft: null,
  /** All files attached to the currently-editing vendor, indexed by
   *  slot. Loaded when the modal opens and refetched after each
   *  upload/delete. Empty for create flow. */
  vendorEditorFiles: [],
  /** vendor.id whose card is currently expanded inline (or null). */
  expandedVendorId: null,
  // ── Quick filters (per view; "" = All). Client-side, stack with search. ──
  taskStatusFilter: "",
  taskGenFilter: "",        // ""|"yes"|"no"
  taskPaidFilter: "",       // ""|"paid"|"unpaid"|"none"
  vendorTypeFilter: "",     // "" | category_id
  vendorLicenseFilter: "",  // ""|"expired"|"expiring"|"valid"|"none"
  vendorCompleteFilter: "", // ""|"complete"|"incomplete"
  clientCrFilter: "",       // ""|"has"|"missing"
  contractFilesFilter: "",  // ""|"both"|"docx"
};

const els = {
  apiStatus: document.querySelector("#api-status"),
  apiUrl: document.querySelector("#api-url"),
  contentTitle: document.querySelector("#view-title"),
  contentSubtitle: document.querySelector("#view-subtitle"),
  dashboard: document.querySelector("#dashboard-view"),
  loginView: document.querySelector("#login-view"),
  loginForm: document.querySelector("#login-form"),
  signupButton: document.querySelector("#signup-button"),
  logoutButton: document.querySelector("#logout-button"),
  refreshButton: document.querySelector("#refresh-button"),
  userRole: document.querySelector("#user-role"),
  viewRoot: document.querySelector("#view-root"),
  toast: document.querySelector("#toast"),
  progressBar: document.querySelector("#progress-bar"),
};

function authHeaders(json = true) {
  const result = {};
  if (json) result["Content-Type"] = "application/json";
  if (state.token) result.Authorization = `Bearer ${state.token}`;
  return result;
}

// ─── Polished progress bar ──────────────────────────────────────────────────
// Sweeps to 90% fast, then crawls. Snaps to 100% when all requests finish.
let _progressTimer = null;
let _progressPct = 0;

function setBusy(isBusy) {
  state.pendingRequests += isBusy ? 1 : -1;
  state.pendingRequests = Math.max(0, state.pendingRequests);
  const bar = els.progressBar;
  const busy = state.pendingRequests > 0;
  document.body.classList.toggle("is-busy", busy);

  if (busy && !_progressTimer) {
    _progressPct = 0;
    bar?.classList.add("active");
    bar?.classList.remove("done");
    // Sweep to 90% rapidly, then crawl
    _progressTimer = setInterval(() => {
      if (_progressPct < 70) _progressPct += 8;
      else if (_progressPct < 90) _progressPct += 2;
      else if (_progressPct < 95) _progressPct += 0.3;
      if (bar) bar.style.setProperty("--prog", `${_progressPct}%`);
    }, 80);
  }
  if (!busy && _progressTimer) {
    clearInterval(_progressTimer);
    _progressTimer = null;
    if (bar) {
      bar.style.setProperty("--prog", "100%");
      bar.classList.add("done");
      setTimeout(() => {
        bar.classList.remove("active", "done");
        bar.style.setProperty("--prog", "0%");
        _progressPct = 0;
      }, 500);
    }
  }
}

function setButtonLoading(button, isLoading) {
  if (!button) return;
  if (isLoading) {
    if (!button.dataset.originalText) button.dataset.originalText = button.textContent.trim();
    button.classList.add("is-loading");
    button.disabled = true;
  } else {
    button.classList.remove("is-loading");
    button.disabled = false;
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }
}

/**
 * Render whatever the backend returned in `detail` as a human-readable
 * string. Handles three shapes:
 *
 *   - String  → returned as-is.
 *   - FastAPI 422 validation array → one line per error:
 *       "body.iban: field required"
 *     (the loc array minus its leading "body"/"path"/"query" prefix +
 *     the msg field).
 *   - Anything else (plain object) → JSON-stringified so something
 *     useful shows up in the UI instead of "[object Object]".
 */
function formatApiError(detail) {
  if (detail == null) return "Request failed";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((entry) => {
      if (!entry || typeof entry !== "object") return String(entry);
      const loc = Array.isArray(entry.loc) ? entry.loc.slice(1).join(".") : "";
      const msg = entry.msg || entry.message || "";
      return loc ? `${loc}: ${msg}` : msg;
    }).filter(Boolean).join("; ") || JSON.stringify(detail);
  }
  if (typeof detail === "object") {
    return detail.message || detail.detail || JSON.stringify(detail);
  }
  return String(detail);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, options = {}) {
  const useJson = options.body !== undefined && !(options.body instanceof FormData);
  setBusy(true);
  const buildInit = () => ({
    ...options,
    headers: {
      ...authHeaders(useJson),
      ...(options.headers || {}),
    },
  });
  try {
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, buildInit());
    } catch (networkError) {
      // Browser-level fetch failure: server down, CORS, stale cached API base, etc.
      // Re-probe the candidate list synchronously and retry once if a different
      // URL turns out to be reachable. This self-heals when localStorage holds
      // a stale port (e.g. 8001 left over from a previous run).
      const previous = API_BASE;
      const recovered = await checkHealth().catch(() => false);
      if (recovered && API_BASE !== previous) {
        try {
          response = await fetch(`${API_BASE}${path}`, buildInit());
        } catch (retryError) {
          throw new Error(
            `Cannot reach backend at ${API_BASE}. Is uvicorn running on port 8000? (${retryError.message})`,
          );
        }
      } else {
        // Cold-start path: the free hosting tier (Render) puts the service to
        // sleep when idle, so the first request after a quiet period fails
        // while the server boots (~30-60s). Wait for it to wake using cheap
        // health pings, THEN retry the original request once. Polling health
        // (rather than re-sending the original) avoids hammering heavy
        // endpoints like PDF generation while the server is still booting.
        showToast("Waking up the server… this can take up to a minute.", "");
        const delays = [2000, 3000, 5000, 8000, 12000, 15000, 20000]; // ~65s
        let awake = false;
        for (const delay of delays) {
          await sleep(delay);
          try {
            const health = await fetch(`${API_BASE}/api/health`, { cache: "no-store" });
            if (health.ok) { awake = true; break; }
          } catch (_) {
            // Still booting — keep waiting.
          }
        }
        if (awake) {
          try {
            response = await fetch(`${API_BASE}${path}`, buildInit());
          } catch (retryError) {
            throw new Error(
              `The server woke up but the request still failed. This can happen when ` +
              `PDF generation runs out of memory on the free hosting tier — please try ` +
              `again. (${retryError.message})`,
            );
          }
        } else {
          throw new Error(
            `Cannot reach backend at ${API_BASE}. The server may still be waking up ` +
            `(the free hosting tier sleeps when idle) — please try again in a minute. ` +
            `(${networkError.message})`,
          );
        }
      }
    }

    if (response.status === 204) return null;

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      // Always surface the backend's actual error message. Most 401s on
      // this backend are role/permission rejections (e.g. "Admin access
      // required") or stale-token messages from the backend itself —
      // showing a generic "log in again" was both misleading and noisy.
      const detail = typeof data === "object"
        ? (data.detail ?? data)
        : (data || `Request failed with ${response.status}`);
      if (response.status === 401) {
        console.warn("401 from", path, ":", detail);
      }
      throw new Error(formatApiError(detail));
    }

    return data;
  } finally {
    setBusy(false);
  }
}

function setApiBase(url) {
  API_BASE = url;
  localStorage.setItem("aq_api_base", url);
  els.apiUrl.textContent = url;
}

async function checkHealth() {
  const candidates = [API_BASE, ...API_CANDIDATES.filter((url) => url !== API_BASE)];

  for (const url of candidates) {
    try {
      const response = await fetch(`${url}/api/health`, { cache: "no-store" });
      if (!response.ok) throw new Error("offline");
      setApiBase(url);
      els.apiStatus.textContent = "API online";
      els.apiStatus.className = "status-dot ok";
      return true;
    } catch {
      // Try next candidate.
    }
  }

  els.apiStatus.textContent = "API offline";
  els.apiStatus.className = "status-dot error";
  els.apiUrl.textContent = "Backend not reachable";
  return false;
}

function showToast(message, type = "") {
  els.toast.textContent = message;
  els.toast.className = `toast ${type}`.trim();
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.add("hidden"), 3600);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function encodeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function money(value) {
  const n = Number(String(value ?? "0").replaceAll(",", ""));
  if (Number.isFinite(n)) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return escapeHtml(value || "0");
}

function fileSize(kb) {
  const n = Number(kb);
  return Number.isFinite(n) ? `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} KB` : "-";
}

function dateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isAdmin() {
  return state.user?.role === "admin";
}

function selectedTask() {
  if (state.selectedTaskId === "__new__") return null;
  return state.tasks.find((task) => task.id === state.selectedTaskId) || state.tasks[0] || null;
}

function selectedVendor() {
  // Returns null when nothing is explicitly selected. Do NOT fall back to
  // state.vendors[0] — the right-side detail panel must stay blank until the
  // user clicks a vendor.
  if (!state.selectedVendorId) return null;
  return state.vendors.find((vendor) => String(vendor.id) === String(state.selectedVendorId)) || null;
}

function selectedClient() {
  if (!state.selectedClientId) return null;
  return state.clients.find((c) => String(c.id) === String(state.selectedClientId)) || null;
}

function findVendorByLicense(license) {
  const value = String(license || "").trim().toLowerCase();
  if (!value) return null;
  return state.vendors.find((vendor) => String(vendor.license_number || "").trim().toLowerCase() === value) || null;
}

function findBank(vendor, bankIdOrIban) {
  const value = String(bankIdOrIban || "");
  return (vendor?.bank_accounts || []).find((bank) => String(bank.id) === value || String(bank.iban) === value) || null;
}

function limitOptions(selected = state.taskLimit) {
  return [5, 10, 25, 50, 100, 0].map((value) => {
    const label = value === 0 ? "All" : String(value);
    return `<option value="${value}" ${Number(selected) === value ? "selected" : ""}>${label}</option>`;
  }).join("");
}

function platformLabel(keyOrLabel) {
  const value = String(keyOrLabel || "").trim().toLowerCase();
  return PLATFORM_OPTIONS.find((platform) => platform.key === value)?.label || keyOrLabel;
}

function displayPlatforms(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(platformLabel)
    .join(", ");
}

function setSignedIn(isSignedIn) {
  els.loginView.classList.toggle("hidden", isSignedIn);
  els.dashboard.classList.toggle("hidden", !isSignedIn);
  els.logoutButton.classList.toggle("hidden", !isSignedIn);
  els.refreshButton.disabled = !isSignedIn;
  // When signed out, hide the dashboard chrome (sidebar + topbar) so the
  // auth cards have the full viewport — same shape as the PM dashboard's
  // login page.
  document.body.classList.toggle("is-auth", !isSignedIn);
}

function renderUser() {
  if (!state.user) {
    els.userRole.textContent = "Signed out";
    return;
  }
  els.userRole.textContent = `${state.user.full_name || state.user.username} · ${state.user.role}`;
}

function statusClass(status) {
  const value = String(status || "").toUpperCase();
  if (["COMPLETED", "DONE", "DELIVERED", "SIGNED"].includes(value)) return "done";
  if (["ON HOLD", "CANCELLED"].includes(value)) return "hold";
  if (["PAYMENT PENDING", "SENT TO VENDOR"].includes(value)) return "warn";
  return "";
}

function pill(label, cls = "") {
  return `<span class="status-pill ${cls}">${escapeHtml(label || "")}</span>`;
}

function cardMetric(label, value, hint = "") {
  return `
    <div class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
    </div>
  `;
}

function templateOptions(selected = defaultTemplateKey()) {
  const options = state.templates.length
    ? state.templates.map((template) => [template.key, template.display_name])
    : TEMPLATE_OPTIONS;
  return options.map(([value, label]) => `
    <option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>
  `).join("");
}

function defaultTemplateKey() {
  return state.templates.find((template) => template.is_default)?.key
    || state.templates[0]?.key
    || "after_pay";
}

function statusOptions(selected = "NEW") {
  return STATUSES.map((value) => `
    <option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>
  `).join("");
}

// ── Quick-filter helpers ─────────────────────────────────────────────
/** A compact toolbar <select> for a quick filter. options = [[value,label],…] */
function filterSelect(id, value, options) {
  return `<select id="${id}" class="cs-select cs-filter" style="width:auto;">${
    options.map(([v, l]) => `<option value="${encodeAttr(v)}" ${String(v) === String(value) ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")
  }</select>`;
}

/** Clear-filters chip, shown only when the current view has an active filter. */
function clearFiltersChip(active) {
  return active ? `<button type="button" class="cs-btn-ghost cs-filter" data-action="clear-filters" style="padding:8px 12px;">Clear filters</button>` : "";
}

/** license_number(lowercased) → "expired"|"expiring", from the admin alerts. */
function expiryByLicense() {
  const m = {};
  for (const a of state.expiryAlerts || []) {
    const lic = String(a.license_number || "").trim().toLowerCase();
    if (lic) m[lic] = a.urgency === "expired" ? "expired" : "expiring";
  }
  return m;
}

/** "expired"|"expiring"|"valid"|"none" for a vendor, given the expiry map. */
function vendorLicenseStatus(v, expMap) {
  const lic = String(v.license_number || "").trim().toLowerCase();
  if (!lic) return "none";
  return expMap[lic] || "valid";
}

/** Complete = name + required identifier (license/ID) + ≥1 bank with an IBAN. */
function vendorIsComplete(v) {
  const cat = findVendorCategory(v.category_id);
  const hasName = !!String(v.name || "").trim();
  const hasId = cat?.requires_license
    ? !!String(v.license_number || "").trim()
    : !!String(v.id_number || v.license_number || "").trim();
  const hasBank = (v.bank_accounts || []).some((b) => String(b.iban || "").trim());
  return hasName && hasId && hasBank;
}

function setView(view) {
  state.view = view;
  localStorage.setItem("aq_view", view);
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });
  renderCurrentView();
}

async function refreshAll() {
  const online = await checkHealth();
  if (!online) throw new Error("Backend is not reachable");

  // Show skeleton placeholders while bulk-loading data
  if (els.viewRoot && !state.tasks.length) {
    els.viewRoot.innerHTML = `<div style="padding:1rem">${skeletonCards(2)}${skeletonLines(4)}</div>`;
  }

  await Promise.all([
    loadTasks(),
    loadVendors({ quiet: true }),
    loadVendorCategories(),
    loadTemplates({ quiet: true }),
    loadContracts({ quiet: true }),
    loadSettings({ quiet: true }),
    loadClients(),
  ]);

  if (isAdmin()) {
    await Promise.all([
      loadAdminData({ quiet: true }),
      loadPendingData({ quiet: true }),
    ]);
  }
}

async function loadTasks() {
  state.tasks = await api("/api/tasks/", { body: undefined });
  if (!state.selectedTaskId && state.tasks[0]) {
    state.selectedTaskId = state.tasks[0].id;
    localStorage.setItem("aq_selected_task", state.selectedTaskId);
  }
  return state.tasks;
}

async function loadSelectedSubtasks() {
  const task = selectedTask();
  if (!task) {
    state.subtasks = [];
    return [];
  }
  state.subtasks = await api(`/api/subtasks/task/${encodeURIComponent(task.id)}`, { body: undefined });
  return state.subtasks;
}

async function loadVendors() {
  state.vendors = await api("/api/vendors/", { body: undefined });
  return state.vendors;
}

/**
 * Load the vendor_categories lookup (id, key, label, requires_license,
 * sort_order). Backed by migration 029 + the new GET /api/vendors/categories
 * endpoint. Cached on `state.vendorCategories` for the form pickers.
 */
async function loadVendorCategories() {
  try {
    state.vendorCategories = await api("/api/vendors/categories", { body: undefined });
    if (!Array.isArray(state.vendorCategories)) state.vendorCategories = [];
  } catch (err) {
    console.error("loadVendorCategories failed:", err);
    state.vendorCategories = [];
  }
  return state.vendorCategories;
}

/** Find a category by id. Returns null if missing. */
function findVendorCategory(categoryId) {
  if (!categoryId) return null;
  return (state.vendorCategories || []).find((c) => String(c.id) === String(categoryId)) || null;
}

async function loadTemplates() {
  state.templates = await api("/api/templates/", { body: undefined });
  return state.templates;
}

async function loadContracts() {
  state.contracts = await api("/api/contracts/archive", { body: undefined });
  return state.contracts;
}

async function loadClients() {
  try {
    state.clients = await api("/api/vendors/clients", { body: undefined });
    if (!Array.isArray(state.clients)) state.clients = [];
  } catch (err) {
    console.error("loadClients failed:", err);
    state.clients = [];
  }
  return state.clients;
}

async function loadClientBrands(clientId) {
  try {
    state.clientBrands = await api(`/api/brands?client_id=${encodeURIComponent(clientId)}`, { body: undefined });
  } catch {
    state.clientBrands = [];
  }
  return state.clientBrands;
}

async function loadSettings() {
  try {
    state.settings = await api("/api/settings/", { body: undefined });
  } catch {
    state.settings = [];
  }
  return state.settings;
}

async function loadAdminData() {
  const results = await Promise.allSettled([
    api("/api/auth/users", { body: undefined }),
    api("/api/audit/", { body: undefined }),
    api("/api/settings/backups/list", { body: undefined }),
    api("/api/auth/invites", { body: undefined }),
  ]);
  state.users   = results[0].status === "fulfilled" ? results[0].value : [];
  state.audit   = results[1].status === "fulfilled" ? results[1].value : [];
  state.backups = results[2].status === "fulfilled" ? results[2].value : [];
  state.invites = results[3].status === "fulfilled" ? results[3].value : [];
}

async function loadPendingData() {
  const results = await Promise.allSettled([
    api("/api/vendors/pending/vendors", { body: undefined }),
    api("/api/vendors/pending/clients", { body: undefined }),
    api("/api/vendors/expiry/alerts", { body: undefined }),
  ]);
  state.pendingVendors = results[0].status === "fulfilled" ? results[0].value : [];
  state.pendingClients = results[1].status === "fulfilled" ? results[1].value : [];
  state.expiryAlerts = results[2].status === "fulfilled" ? results[2].value : [];
}

function updateHeader(title, subtitle) {
  els.contentTitle.textContent = title;
  els.contentSubtitle.textContent = subtitle;
}

function renderCurrentView() {
  if (!state.user) return;

  const renderers = {
    dashboard: renderDashboard,
    tasks: renderTasksView,
    vendors: renderVendorsView,
    clients: renderClientsView,
    contracts: renderContractsView,
    templates: renderTemplatesView,
    settings: renderSettingsView,
  };

  (renderers[state.view] || renderDashboard)();
}

function renderDashboard() {
  updateHeader("Operations", "Contract pipeline, generation readiness, and payment status at a glance.");

  const doneSet = new Set(["COMPLETED", "DONE", "DELIVERED", "SIGNED"]);
  const tasks = state.tasks;
  const totalTasks = tasks.length;
  const totalAmount = tasks.reduce((sum, task) => sum + (Number(String(task.amount || "0").replaceAll(",", "")) || 0), 0);
  const active = tasks.filter((task) => !doneSet.has(String(task.status).toUpperCase())).length;
  const completed = totalTasks - active;
  const brandCount = new Set(tasks.map((task) => (task.brand || "").trim().toLowerCase()).filter(Boolean)).size;
  const activePct = totalTasks ? Math.round((active / totalTasks) * 1000) / 10 : 0;
  const missingTemplates = state.templates.filter((template) => !template.file_exists).length;

  // Generated contracts grouped by task → how many tasks have any output.
  const genByTask = {};
  for (const c of state.contracts) {
    const tid = String(c.task_id || "");
    if (tid) genByTask[tid] = (genByTask[tid] || 0) + 1;
  }
  const contractsGenerated = state.contracts.length;
  const tasksGenerated = tasks.filter((task) => genByTask[String(task.id)]).length;
  const tasksAwaiting = totalTasks - tasksGenerated;
  const unpaidSubtasks = tasks.reduce((sum, task) => sum + Math.max(0, Number(task.subtask_count || 0) - Number(task.paid_count || 0)), 0);

  // Pipeline bar flex weights (avoid 0/0 collapse).
  const newFlex = active || (totalTasks ? 0 : 1);
  const doneFlex = completed;

  const cols = "128px minmax(140px,1fr) 96px 96px 120px";
  const recent = tasks.slice(0, 10);
  const rows = recent.map((task) => {
    const total = Number(task.subtask_count || 0);
    const gen = Number(genByTask[String(task.id)] || 0);
    const pct = total ? Math.min(100, Math.round((gen / total) * 100)) : 0;
    const st = String(task.status || "NEW").toUpperCase();
    const solid = doneSet.has(st);
    return `
      <div class="cs-row" data-action="open-task" data-id="${encodeAttr(task.id)}" style="grid-template-columns:${cols}; cursor:pointer;">
        <div class="cs-cell-id">${escapeHtml(task.id)}</div>
        <div class="cs-bidi" style="font-size:13.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:14px;">${escapeHtml(task.brand || "—")}</div>
        <div class="cs-cell-num">${money(task.amount)}</div>
        <div style="text-align:center;"><span class="cs-pill ${solid ? "is-solid" : ""}">${escapeHtml(st)}</span></div>
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;">
          <span class="cs-mono" style="font-size:12px;color:var(--cs-muted);">${gen} / ${total}</span>
          <span style="width:34px;height:5px;border-radius:3px;background:var(--cs-track);position:relative;overflow:hidden;"><span style="position:absolute;inset:0;width:${pct}%;background:var(--cs-accent);"></span></span>
        </div>
      </div>`;
  }).join("");

  els.viewRoot.innerHTML = `
    <div class="cs-ops-actions" style="display:flex;justify-content:flex-end;gap:10px;margin-bottom:18px;">
      <button class="cs-btn" type="button" data-action="go-tasks">New Task</button>
      <button class="cs-btn-ghost" type="button" data-action="go-contracts">Generate</button>
    </div>

    <section class="cs-kpi-strip" style="margin-bottom:14px;">
      <div class="cs-kpi">
        <div class="cs-kpi-label">Total Tasks</div>
        <div class="cs-kpi-num">${totalTasks.toLocaleString()}</div>
        <div class="cs-kpi-sub">across ${brandCount} brand${brandCount === 1 ? "" : "s"}</div>
      </div>
      <div class="cs-kpi">
        <div class="cs-kpi-label">Active</div>
        <div class="cs-kpi-num">${active.toLocaleString()}</div>
        <div class="cs-kpi-sub">${activePct}% of pipeline</div>
      </div>
      <div class="cs-kpi">
        <div class="cs-kpi-label">Completed</div>
        <div class="cs-kpi-num">${completed.toLocaleString()}</div>
        <div class="cs-kpi-sub">closed out</div>
      </div>
      <div class="cs-kpi is-tile">
        <div class="cs-kpi-label">Pipeline Value</div>
        <div style="display:flex;align-items:baseline;gap:6px;margin-top:8px;">
          <span class="cs-mono" style="font-size:34px;font-weight:600;letter-spacing:-0.02em;line-height:1;">${money(totalAmount)}</span>
          <span style="font-size:13px;color:rgba(255,255,255,.5);font-weight:500;">SAR</span>
        </div>
        <div class="cs-kpi-sub">gross contract amount</div>
      </div>
    </section>

    <section class="cs-card" style="margin-bottom:22px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div style="font-size:13px;font-weight:600;letter-spacing:.01em;">Generation pipeline</div>
        <div style="font-size:12px;color:var(--cs-muted);">${contractsGenerated} contract${contractsGenerated === 1 ? "" : "s"} generated · <span style="color:var(--cs-accent);font-weight:600;">${tasksAwaiting} task${tasksAwaiting === 1 ? "" : "s"} awaiting generation</span></div>
      </div>
      <div style="display:flex;height:10px;border-radius:6px;overflow:hidden;gap:2px;background:var(--cs-track);">
        <div style="flex:${newFlex};background:var(--cs-solid);"></div>
        <div style="flex:${doneFlex};background:#b9b9b1;"></div>
      </div>
      <div style="display:flex;gap:28px;margin-top:14px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--cs-ink2);"><span style="width:9px;height:9px;border-radius:2px;background:var(--cs-solid);"></span>New&nbsp;<span class="cs-mono" style="font-weight:600;color:var(--cs-ink);">${active}</span></div>
        <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--cs-ink2);"><span style="width:9px;height:9px;border-radius:2px;background:#b9b9b1;"></span>Completed&nbsp;<span class="cs-mono" style="font-weight:600;color:var(--cs-ink);">${completed}</span></div>
        <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--cs-ink2);"><span style="width:9px;height:9px;border-radius:50%;background:var(--cs-accent);"></span>Unpaid subtasks&nbsp;<span class="cs-mono" style="font-weight:600;color:var(--cs-ink);">${unpaidSubtasks}</span></div>
      </div>
    </section>

    <section style="display:grid;grid-template-columns:1fr 312px;gap:22px;align-items:start;">
      <div class="cs-card-flush">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px 14px;">
          <div class="cs-section-title">Recent tasks</div>
          <button class="cs-lnk" type="button" data-action="go-tasks" style="font-size:12.5px;font-weight:600;color:var(--cs-ink2);background:none;border:none;cursor:pointer;padding:0;font-family:inherit;">View all ${totalTasks} →</button>
        </div>
        <div class="cs-thead" style="grid-template-columns:${cols};">
          <div>ID</div><div>Brand</div><div style="text-align:right;">Amount</div><div style="text-align:center;">Status</div><div style="text-align:right;">Subtasks</div>
        </div>
        ${rows || `<div class="cs-table-note">No tasks yet.</div>`}
        <div class="cs-table-note">Showing ${recent.length} of ${totalTasks} task${totalTasks === 1 ? "" : "s"}</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:22px;">
        <div class="cs-card">
          <div class="cs-section-title" style="margin-bottom:16px;">Readiness</div>
          <div style="display:flex;flex-direction:column;">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 0;border-bottom:1px solid var(--cs-divider2);">
              <span style="font-size:13.5px;color:var(--cs-ink2);">Templates</span>
              ${missingTemplates
                ? `<span class="cs-pill is-warn">${missingTemplates} MISSING</span>`
                : `<span style="display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;"><span style="width:7px;height:7px;border-radius:50%;background:var(--cs-solid);"></span>Ready</span>`}
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 0;border-bottom:1px solid var(--cs-divider2);">
              <span style="font-size:13.5px;color:var(--cs-ink2);">Approved vendors</span>
              <span class="cs-mono" style="font-size:14px;font-weight:600;">${state.vendors.length.toLocaleString()}</span>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 0;border-bottom:1px solid var(--cs-divider2);">
              <span style="font-size:13.5px;color:var(--cs-ink2);">Archived contracts</span>
              <span class="cs-mono" style="font-size:14px;font-weight:600;">${contractsGenerated.toLocaleString()}</span>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 0;">
              <span style="font-size:13.5px;color:var(--cs-ink2);">Your role</span>
              <span class="cs-pill is-solid">${escapeHtml(String(state.user.role || "").toUpperCase())}</span>
            </div>
          </div>
        </div>

        <div class="cs-card">
          <div class="cs-section-title" style="margin-bottom:6px;">Needs attention</div>
          <p style="margin:0 0 14px;font-size:12.5px;color:var(--cs-muted);line-height:1.4;">Surfaced from open subtasks.</p>
          ${tasksAwaiting > 0 ? `
          <div style="display:flex;align-items:flex-start;gap:11px;padding:12px;border-radius:10px;background:var(--cs-warn-bg);border:1px solid var(--cs-warn-bd);">
            <span style="width:8px;height:8px;border-radius:50%;background:var(--cs-accent);margin-top:5px;flex:none;"></span>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--cs-ink);">${tasksGenerated} of ${totalTasks} tasks generated</div>
              <div style="font-size:12px;color:var(--cs-accent-ink);margin-top:3px;">${tasksAwaiting} task${tasksAwaiting === 1 ? "" : "s"} queued but no contracts produced yet.</div>
            </div>
          </div>` : ""}
          ${unpaidSubtasks > 0 ? `
          <div style="display:flex;align-items:flex-start;gap:11px;padding:12px;border-radius:10px;background:var(--cs-warn-bg);border:1px solid var(--cs-warn-bd);margin-top:10px;">
            <span style="width:8px;height:8px;border-radius:50%;background:var(--cs-accent);margin-top:5px;flex:none;"></span>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--cs-ink);">Vendor payments unpaid</div>
              <div style="font-size:12px;color:var(--cs-accent-ink);margin-top:3px;">${unpaidSubtasks} subtask${unpaidSubtasks === 1 ? "" : "s"} across tasks still marked unpaid.</div>
            </div>
          </div>` : ""}
          ${tasksAwaiting === 0 && unpaidSubtasks === 0 ? `<div style="font-size:12.5px;color:var(--cs-muted);">Nothing needs attention.</div>` : ""}
        </div>
      </div>
    </section>
  `;
}

function renderTaskTable(tasks, compact = false) {
  const rows = tasks.map((task) => `
    <tr class="${task.id === state.selectedTaskId ? "selected-row" : ""}" data-task-id="${encodeAttr(task.id)}">
      <td>${escapeHtml(task.id)}</td>
      <td>${escapeHtml(task.brand)}</td>
      <td>${money(task.amount)}</td>
      <td>${pill(task.status || "NEW", statusClass(task.status))}</td>
      ${compact ? "" : `<td>${escapeHtml(task.contract_type || "after_pay")}</td>`}
      <td>${Number(task.subtask_count || 0)} / ${Number(task.paid_count || 0)}</td>
      ${compact ? "" : `<td class="actions-cell"><button type="button" class="row-edit-button" data-action="edit-task" data-id="${encodeAttr(task.id)}">Edit</button></td>`}
    </tr>
  `).join("");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Brand</th>
            <th>Amount</th>
            <th>Status</th>
            ${compact ? "" : "<th>Type</th>"}
            <th>Subtasks</th>
            ${compact ? "" : "<th></th>"}
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="${compact ? 5 : 7}">No tasks found</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

async function renderTasksView() {
  updateHeader("Tasks", "Campaigns, subtasks, payment tracking, and generation prep");
  // Show skeleton while loading subtasks
  if (!state.subtasks.length && state.selectedTaskId) {
    els.viewRoot.innerHTML = `<div style="padding:1rem">${skeletonLines(3)}${skeletonRows(2)}</div>`;
  }
  await loadSelectedSubtasks().catch(() => []);
  const task = selectedTask();
  const activeTaskTemplate = state.templates.some((template) => template.key === task?.contract_type)
    ? task.contract_type
    : defaultTemplateKey();
  const query = state.search.trim().toLowerCase();
  // Generated-contract count per task (drives the "Generated" filter + column).
  const genByTaskId = {};
  for (const c of state.contracts) {
    const tid = String(c.task_id || "");
    if (tid) genByTaskId[tid] = (genByTaskId[tid] || 0) + 1;
  }
  const tasks = state.tasks.filter((item) => {
    // Search — match on brand, id, vendor, license, client, CR, contract id…
    if (query && ![
      item.brand, item.id, item.vendor, item.license_number,
      item.client_name, item.cr_number, item.contract_id,
      item.signatory_name, item.email,
    ].some((v) => String(v || "").toLowerCase().includes(query))) return false;
    // Status filter
    if (state.taskStatusFilter && String(item.status || "").toUpperCase() !== state.taskStatusFilter) return false;
    // Generated filter
    if (state.taskGenFilter) {
      const gen = genByTaskId[String(item.id)] || 0;
      if (state.taskGenFilter === "yes" && gen === 0) return false;
      if (state.taskGenFilter === "no" && gen > 0) return false;
    }
    // Payment filter (rolled up from subtasks)
    if (state.taskPaidFilter) {
      const total = Number(item.subtask_count || 0), paid = Number(item.paid_count || 0);
      if (state.taskPaidFilter === "none" && total !== 0) return false;
      if (state.taskPaidFilter === "paid" && !(total > 0 && paid >= total)) return false;
      if (state.taskPaidFilter === "unpaid" && !(total > 0 && paid < total)) return false;
    }
    return true;
  });
  const visibleTasks = state.taskLimit ? tasks.slice(0, Math.max(5, state.taskLimit)) : tasks;

  const selectedCount = state.selectedSubtaskIds?.size || 0;
  const editorOpen = Boolean(state.taskEditorOpen);
  const subtaskEditorOpen = Boolean(state.subtaskEditorOpen) && !state.clientMode;
  const editorMode = state.taskEditorMode || (task ? "edit" : "new");
  const editingTask = editorMode === "new" ? null : task;

  const doneSet = new Set(["COMPLETED", "DONE", "DELIVERED", "SIGNED"]);
  const genByTask = {};
  for (const c of state.contracts) {
    const tid = String(c.task_id || "");
    if (tid) genByTask[tid] = (genByTask[tid] || 0) + 1;
  }
  const taskSel = state.taskSel || (state.taskSel = new Set());
  const taskCols = "38px 120px minmax(150px,1fr) 104px 92px 132px 116px 56px";
  const allTasksChecked = visibleTasks.length > 0 && visibleTasks.every((t) => taskSel.has(String(t.id)));
  const taskRows = visibleTasks.map((t) => {
    const total = Number(t.subtask_count || 0);
    const gen = Number(genByTask[String(t.id)] || 0);
    const pct = total ? Math.min(100, Math.round((gen / total) * 100)) : 0;
    const st = String(t.status || "NEW").toUpperCase();
    const isSel = String(t.id) === String(state.selectedTaskId);
    return `
      <div class="cs-row ${isSel ? "is-selected" : ""}" data-task-row data-id="${encodeAttr(t.id)}" style="grid-template-columns:${taskCols}; cursor:pointer;">
        <div><input type="checkbox" class="cs-check task-pick" data-id="${encodeAttr(t.id)}" ${taskSel.has(String(t.id)) ? "checked" : ""} /></div>
        <div class="cs-cell-id">${escapeHtml(t.id)}</div>
        <div class="cs-bidi" style="font-size:13.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:14px;">${escapeHtml(t.brand || "—")}</div>
        <div class="cs-cell-num">${money(t.amount)}</div>
        <div style="text-align:center;"><span class="cs-pill ${doneSet.has(st) ? "is-solid" : ""}">${escapeHtml(st)}</span></div>
        <div class="cs-mono" style="font-size:12px;color:var(--cs-monoink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.contract_type || "after_pay")}</div>
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;">
          <span class="cs-mono" style="font-size:12px;color:var(--cs-muted);">${gen} / ${total}</span>
          <span style="width:34px;height:5px;border-radius:3px;background:var(--cs-track);position:relative;overflow:hidden;"><span style="position:absolute;inset:0;width:${pct}%;background:var(--cs-accent);"></span></span>
        </div>
        <div class="cs-rowact"><button class="cs-iconbtn" type="button" data-action="edit-task" data-id="${encodeAttr(t.id)}" title="Edit task">Edit</button></div>
      </div>`;
  }).join("");

  els.viewRoot.innerHTML = `
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-bottom:18px;">
      <button class="cs-btn" type="button" data-action="open-new-task">+ New Task</button>
    </div>

    <div class="cs-card-flush" style="margin-bottom:22px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:18px;padding:18px 22px 16px;flex-wrap:wrap;">
        <div>
          <div class="cs-section-title">Contract tasks</div>
          <div style="font-size:12.5px;color:var(--cs-muted);margin-top:3px;">${tasks.length} matching · showing ${visibleTasks.length}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div class="cs-search"><span class="cs-search-ring"></span><input id="task-search" placeholder="Search brand, vendor, license, ID…" value="${encodeAttr(state.search)}" /></div>
          ${filterSelect("task-status-filter", state.taskStatusFilter, [["", "All statuses"], ...STATUSES.map((s) => [s, s])])}
          ${filterSelect("task-gen-filter", state.taskGenFilter, [["", "Generated: all"], ["yes", "Generated"], ["no", "Not generated"]])}
          ${filterSelect("task-paid-filter", state.taskPaidFilter, [["", "Payment: all"], ["paid", "Fully paid"], ["unpaid", "Has unpaid"], ["none", "No subtasks"]])}
          ${clearFiltersChip(state.taskStatusFilter || state.taskGenFilter || state.taskPaidFilter)}
          <select id="task-limit" class="cs-select" style="width:auto;">${limitOptions()}</select>
          <button class="cs-btn-ghost" type="button" data-action="duplicate-task" ${task ? "" : "disabled"}>Duplicate</button>
          <button class="cs-btn-danger" type="button" data-action="delete-task" ${task ? "" : "disabled"}>Delete</button>
        </div>
      </div>
      ${taskSel.size ? `
      <div class="cs-bulkbar" style="margin:0 22px 14px;">
        <span class="cs-bulk-count">${taskSel.size} selected</span>
        <button class="cs-bulk-btn is-danger" type="button" data-action="delete-tasks-bulk">Delete</button>
        <span class="cs-bulk-spacer"></span>
        <button class="cs-bulk-btn" type="button" data-action="clear-task-sel">Clear</button>
      </div>` : ""}
      <div class="cs-thead" style="grid-template-columns:${taskCols};">
        <div><input type="checkbox" id="task-pick-all" class="cs-check" ${allTasksChecked ? "checked" : ""} title="Select all" /></div><div>ID</div><div>Brand</div><div style="text-align:right;">Amount</div><div style="text-align:center;">Status</div><div>Type</div><div style="text-align:right;">Subtasks</div><div></div>
      </div>
      ${taskRows || `<div class="cs-table-note">No matching tasks.</div>`}
      <div class="cs-table-note">Showing ${visibleTasks.length} of ${tasks.length} matching tasks. Minimum page size is 5.</div>
    </div>

    <div class="cs-card-flush">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 22px;flex-wrap:wrap;border-bottom:1px solid var(--cs-divider);">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          <div class="cs-tabs" role="tablist">
            <button type="button" class="cs-tab ${state.clientMode ? "" : "active"}" data-action="set-vendor-mode" role="tab">Vendor subtasks</button>
            <button type="button" class="cs-tab ${state.clientMode ? "active" : ""}" data-action="set-client-mode" role="tab" ${task ? "" : "disabled"}>Client contract</button>
          </div>
          ${task ? `<span class="cs-mono" style="font-size:12.5px;color:var(--cs-muted);">${escapeHtml(task.id)} · <span class="cs-bidi" style="font-family:'IBM Plex Sans','IBM Plex Sans Arabic',sans-serif;">${escapeHtml(task.brand || "")}</span></span>` : `<span style="font-size:13px;color:var(--cs-muted);">Select a task above</span>`}
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          ${state.clientMode ? `
            <button class="cs-btn" type="button" data-action="generate-client-contract" ${task ? "" : "disabled"} title="Generate client contract">Generate client contract</button>
          ` : `
            <button class="cs-btn-ghost" type="button" data-action="open-add-subtask" ${task ? "" : "disabled"}>+ Add subtask</button>
            <div class="generate-menu" style="position:relative;">
              <button class="cs-btn" type="button" data-action="toggle-generate-menu" ${task && state.subtasks.length ? "" : "disabled"} aria-haspopup="menu" aria-expanded="false">Generate ▾</button>
              <div class="generate-menu-popup" id="generate-menu-popup" hidden role="menu">
                <button type="button" class="generate-menu-item" data-action="generate-all" role="menuitem" ${state.subtasks.length ? "" : "disabled"}>All subtasks <span class="menu-badge">${state.subtasks.length}</span></button>
                <button type="button" class="generate-menu-item" data-action="generate-selected" role="menuitem" ${selectedCount ? "" : "disabled"}>Selected only <span class="menu-badge">${selectedCount}</span></button>
                <div class="generate-menu-divider" role="separator"></div>
                <button type="button" class="generate-menu-item" data-action="download-task-contracts" role="menuitem" data-task-id="${encodeAttr(task?.id || "")}" ${task ? "" : "disabled"}>Download existing contracts</button>
              </div>
            </div>
          `}
        </div>
      </div>

      ${state.clientMode ? `
        <div style="display:grid;grid-template-columns:1fr 320px;gap:0;align-items:start;">
          <div style="border-right:1px solid var(--cs-divider);">${renderSubtaskTable()}</div>
          <div style="padding:20px 22px;">
            <div class="cs-section-title" style="margin-bottom:14px;">Client contract settings</div>
            <div class="cs-field-group">
              <label class="cs-label">Client</label>
              <select id="cc-client-select" class="cs-select">
                <option value="">— select client —</option>
                ${state.clients.map((c) => `<option value="${encodeAttr(c.id)}">${escapeHtml(c.company_name || c.name || "")}</option>`).join("")}
              </select>
            </div>
            <div id="cc-client-details" style="font-size:12.5px;color:var(--cs-muted);line-height:1.7;margin:0 0 14px;"></div>
            <div class="cs-field-group">
              <label class="cs-label">Brand</label>
              <select id="cc-brand-select" class="cs-select"><option value="">— select client first —</option></select>
            </div>
            <div class="cs-field-group">
              <label class="cs-label">Total amount</label>
              <input id="cc-total-amount" class="cs-input" type="text" value="${encodeAttr(task?.amount || "0")}" />
            </div>
            <p class="cs-form-hint">Pick a client, then "Generate client contract" above. The influencer table is built from the subtasks on the left.</p>
          </div>
        </div>
      ` : `
        ${selectedCount ? `
        <div class="cs-bulkbar" style="margin:14px 22px 0;">
          <span class="cs-bulk-count">${selectedCount} selected</span>
          <button class="cs-bulk-btn" type="button" data-action="generate-selected">Generate</button>
          <span class="cs-bulk-spacer"></span>
          <button class="cs-bulk-btn" type="button" data-action="clear-subtask-sel">Clear</button>
        </div>` : ""}
        ${renderSubtaskTable()}
      `}
    </div>

    ${editorOpen ? `
    <div class="cs-scrim" id="task-editor-overlay" data-dismiss-overlay>
      <div class="cs-modal" role="dialog" aria-modal="true" aria-labelledby="task-editor-title">
        <div class="cs-modal-head">
          <div class="cs-modal-title" id="task-editor-title">${editingTask ? "Edit task" : "New task"}</div>
          <button type="button" class="cs-modal-close" data-action="close-task-editor" aria-label="Close">✕</button>
        </div>
        <form id="task-form">
          <div class="cs-modal-body">
            <input type="hidden" id="task-id" value="${encodeAttr(editingTask?.id || "")}" />
            <div class="cs-field-group"><label class="cs-label">Brand</label><input id="task-brand" class="cs-input" required value="${encodeAttr(editingTask?.brand || "")}" /></div>
            <div class="cs-field-group"><label class="cs-label">Contract Length (days)</label><input id="task-duration" class="cs-input" inputmode="numeric" placeholder="e.g. 30 or 60-90" value="${encodeAttr(editingTask?.duration || "")}" /><p class="cs-form-hint">Fills the {{ duration }} field on every contract for this task. Leave blank to keep the template default.</p></div>
            <div class="cs-field-group"><label class="cs-label">Amount</label><input id="task-amount" class="cs-input" inputmode="decimal" readonly value="${encodeAttr(editingTask?.amount || "0.00")}" /><p class="cs-form-hint">Calculated automatically from subtask prices.</p></div>
            <div class="cs-field-group"><label class="cs-label">Contract Type</label><select id="task-type" class="cs-select">${templateOptions(activeTaskTemplate)}</select></div>
            <div class="cs-field-group"><label class="cs-label">Status</label><select id="task-status" class="cs-select">${statusOptions(editingTask?.status || "NEW")}</select></div>
            <div class="cs-field-group"><label class="cs-label">End Date</label><input id="task-end-date" class="cs-input" type="date" value="${encodeAttr((editingTask?.end_date || "").slice(0, 10))}" /></div>
            <div class="cs-field-group"><label class="cs-label">Notes</label><textarea id="task-notes" class="cs-textarea" rows="4">${escapeHtml(editingTask?.notes || "")}</textarea></div>
          </div>
          <div class="cs-modal-foot">
            ${editingTask ? `<button class="cs-btn-danger" type="button" data-action="delete-task">Delete task</button>` : ""}
            <span class="cs-foot-spacer"></span>
            <button class="cs-btn-ghost" type="button" data-action="close-task-editor">Cancel</button>
            <button class="cs-btn" type="submit">${editingTask ? "Save task" : "Create task"}</button>
          </div>
        </form>
      </div>
    </div>` : ""}

    ${(subtaskEditorOpen && !state.clientMode) ? `
    <div class="cs-scrim" id="subtask-editor-overlay" data-dismiss-overlay>
      <div class="cs-modal is-wide" role="dialog" aria-modal="true" aria-labelledby="subtask-editor-title">
        <div class="cs-modal-head">
          <div class="cs-modal-title" id="subtask-editor-title">Add vendor subtask</div>
          <button type="button" class="cs-modal-close" data-action="close-add-subtask" aria-label="Close">✕</button>
        </div>
        <form id="subtask-form">
          <div class="cs-modal-body">
            <div class="cs-field-group">
              <label class="cs-label">Vendor (license or name)</label>
              <div class="autocomplete-wrap">
                <input id="sub-license" class="cs-input" autocomplete="off" placeholder="Type to search vendors…" />
                <div id="sub-license-suggestions" class="autocomplete-suggestions" hidden></div>
              </div>
            </div>
            <div class="cs-field-group"><label class="cs-label">Vendor Name</label><input id="sub-vendor" class="cs-input cs-bidi" readonly required placeholder="Autofills from license" /></div>
            <div class="cs-field-group"><label class="cs-label">IBAN</label><select id="sub-iban" class="cs-select" disabled><option value="">Choose vendor license first</option></select></div>
            <div id="sub-bank-preview" class="bank-preview" style="background:var(--cs-soft);border:1px solid var(--cs-card-bd);border-radius:9px;padding:10px 12px;margin-bottom:16px;font-size:12.5px;">
              <strong>Bank information</strong>
              <span>Choose a vendor license and IBAN.</span>
            </div>
            <div class="cs-field-group">
              <label class="cs-label">Platforms</label>
              <details class="platform-picker">
                <summary>Choose platforms</summary>
                <div class="platform-options">
                  ${PLATFORM_OPTIONS.map((platform) => `
                    <label class="checkbox-row">
                      <input type="checkbox" class="platform-checkbox" value="${platform.key}" />
                      <span>${platform.label}</span>
                    </label>
                  `).join("")}
                </div>
              </details>
            </div>
            <div id="platform-handles" class="platform-handles">
              <p class="cs-form-hint">Select a platform to add its handle.</p>
            </div>
            <input id="sub-channel" type="hidden" />
            <input id="sub-platforms" type="hidden" />
            <div class="cs-field-group">
              <label class="cs-label">Ad Type</label>
              <select id="sub-ad-type" class="cs-select">
                <option>Store Visit</option>
                <option>Home Ad</option>
                <option>Multi Service</option>
              </select>
            </div>
            <div class="cs-field-group" id="sub-ad-type-custom-label" style="display:none">
              <label class="cs-label">Multi-service text</label>
              <input id="sub-ad-type-custom" class="cs-input" placeholder="What does this multi-service cover?" />
            </div>
            <div class="cs-field-group"><label class="cs-label">Qty</label><input id="sub-qty" class="cs-input" value="1" /></div>
            <div class="cs-field-group"><label class="cs-label">Price</label><input id="sub-price" class="cs-input" value="0" /></div>
            <div class="cs-field-group"><label class="cs-label">Details</label><textarea id="sub-details" class="cs-textarea" rows="3"></textarea></div>
          </div>
          <div class="cs-modal-foot">
            <span class="cs-foot-spacer"></span>
            <button class="cs-btn-ghost" type="button" data-action="close-add-subtask">Cancel</button>
            <button class="cs-btn" type="submit" ${task ? "" : "disabled"}>Add subtask</button>
          </div>
        </form>
      </div>
    </div>` : ""}
  `;
}

function renderSubtaskTable() {
  const selected = state.selectedSubtaskIds || (state.selectedSubtaskIds = new Set());
  const allChecked = state.subtasks.length > 0
    && state.subtasks.every((s) => selected.has(String(s.id)));
  const unpaidCount = state.subtasks.filter((s) => !s.paid_at).length;
  const cols = "38px 150px minmax(150px,1fr) 120px 120px 96px 104px 172px";

  const rows = state.subtasks.map((sub) => {
    const checked = selected.has(String(sub.id)) ? "checked" : "";
    return `
      <div class="cs-row" style="grid-template-columns:${cols};">
        <div><input type="checkbox" class="cs-check subtask-pick" data-id="${sub.id}" ${checked} /></div>
        <div class="cs-cell-id">${escapeHtml(sub.lic_id || sub.id)}</div>
        <div class="cs-bidi" style="font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:10px;">${escapeHtml(sub.vendor || "—")}</div>
        <div style="font-size:13px;color:var(--cs-ink2);">${escapeHtml(displayPlatforms(sub.platforms)) || "<span class='cs-empty'>—</span>"}</div>
        <div style="font-size:13px;color:var(--cs-ink2);">${escapeHtml(sub.ad_type || "")} ×${escapeHtml(sub.qty || "1")}</div>
        <div class="cs-cell-num">${money(sub.price)}</div>
        <div>${sub.paid_at ? `<span class="cs-pill is-solid">PAID</span>` : `<span class="cs-pill is-warn">UNPAID</span>`}</div>
        <div class="cs-rowact">
          <button class="cs-iconbtn" type="button" data-action="generate-one" data-id="${sub.id}" title="Generate contract for just this subtask">Generate</button>
          <button class="cs-iconbtn" type="button" data-action="mark-paid" data-id="${sub.id}">${sub.paid_at ? "Unpay" : "Paid"}</button>
          <button class="cs-iconbtn is-danger" type="button" data-action="delete-subtask" data-id="${sub.id}">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="cs-thead" style="grid-template-columns:${cols};">
      <div><input type="checkbox" id="subtask-pick-all" class="cs-check" ${allChecked ? "checked" : ""} title="Select all" /></div>
      <div>License</div><div>Vendor</div><div>Platform</div><div>Ad</div><div style="text-align:right;">Price</div><div>Payment</div><div></div>
    </div>
    ${rows || `<div class="cs-table-note">No subtasks for this task.</div>`}
    <div class="cs-table-note">${state.subtasks.length} vendor subtask${state.subtasks.length === 1 ? "" : "s"} · ${unpaidCount} unpaid</div>
  `;
}

/**
 * Render the shared field block for the New Vendor / Edit Vendor forms.
 *
 * `mode`:
 *   "new"  → input IDs prefixed `#vendor-*` (matches the existing
 *            #vendor-name + #vendor-license naming)
 *   "edit" → input IDs prefixed `#vendor-edit-*`
 *
 * `vendor`: the row being edited, or null for the create form.
 *
 * Field set mirrors what PM-app VendorsView ships:
 *   Category picker → ID/License (auto-switched by requires_license)
 *   Signatory, Contact name/phone/email, VAT, Details (always shown)
 *   Per-category optional: location_link, short_address, age, gender,
 *   rental_type, event_opening, event_ceremony, location_type
 *
 * Per-category visibility is set initially based on the saved category;
 * the change handler on `#{prefix}-category` updates visibility live.
 */
function renderVendorFormFields(mode, vendor) {
  const prefix = mode === "edit" ? "vendor-edit" : "vendor";
  const categories = state.vendorCategories || [];
  const catId = vendor?.category_id || "";
  const cat = findVendorCategory(catId);
  const requiresLicense = !!cat?.requires_license;
  const catKey = cat?.key || "";

  const categoryOptions = `
    <option value="">— select a category —</option>
    ${categories.map((c) => `
      <option value="${encodeAttr(c.id)}" ${c.id === catId ? "selected" : ""}>
        ${escapeHtml(c.label)}
      </option>
    `).join("")}
  `;

  const showWhen = (visible) => `style="${visible ? "" : "display:none"}"`;

  return `
    <label>Category
      <select id="${prefix}-category" required>${categoryOptions}</select>
    </label>
    <label>Vendor name <input id="${prefix}-name" required value="${encodeAttr(vendor?.name || "")}" /></label>

    <!-- ID and License are mutually visible: License for Influencer+UGC, ID for the rest. -->
    <label id="${prefix}-id-label" ${showWhen(!requiresLicense)}>
      ID number
      <input id="${prefix}-id-number" value="${encodeAttr(vendor?.id_number || "")}" />
    </label>
    <label id="${prefix}-license-label" ${showWhen(requiresLicense)}>
      License number
      <input id="${prefix}-license" value="${encodeAttr(vendor?.license_number || "")}" />
    </label>

    <label>Signatory name
      <input id="${prefix}-signatory" placeholder="Who signs the contract" value="${encodeAttr(vendor?.signatory_name || "")}" />
    </label>
    <label>Contact name
      <input id="${prefix}-contact-name" value="${encodeAttr(vendor?.contact_name || "")}" />
    </label>
    <label>Contact phone
      <input id="${prefix}-phone" value="${encodeAttr(vendor?.phone || "")}" />
    </label>
    <label>Contact email
      <input id="${prefix}-email" type="email" value="${encodeAttr(vendor?.email || "")}" />
    </label>
    <label>VAT number (optional)
      <input id="${prefix}-vat" value="${encodeAttr(vendor?.vat_number || "")}" />
    </label>

    <!-- Per-category optional fields. Visibility toggled by category change. -->
    <label id="${prefix}-location-link-label" ${showWhen(catKey === "logistics" || catKey === "location")}>
      Location link (optional)
      <input id="${prefix}-location-link" placeholder="Google Maps URL" value="${encodeAttr(vendor?.location_link || "")}" />
    </label>
    <label id="${prefix}-short-address-label" ${showWhen(catKey === "logistics")}>
      Short address (optional)
      <input id="${prefix}-short-address" value="${encodeAttr(vendor?.short_address || "")}" />
    </label>
    <label id="${prefix}-age-label" ${showWhen(catKey === "model")}>
      Age (optional)
      <input id="${prefix}-age" type="number" min="0" value="${vendor?.age != null ? vendor.age : ""}" />
    </label>
    <label id="${prefix}-gender-label" ${showWhen(catKey === "model")}>
      Gender (optional)
      <select id="${prefix}-gender">
        <option value="">—</option>
        <option value="male"   ${vendor?.gender === "male"   ? "selected" : ""}>Male</option>
        <option value="female" ${vendor?.gender === "female" ? "selected" : ""}>Female</option>
      </select>
    </label>
    <label id="${prefix}-rental-type-label" ${showWhen(catKey === "rentals")}>
      Rental type (optional)
      <input id="${prefix}-rental-type" value="${encodeAttr(vendor?.rental_type || "")}" />
    </label>
    <label id="${prefix}-event-opening-label" ${showWhen(catKey === "events")}>
      Opening (optional)
      <input id="${prefix}-event-opening" value="${encodeAttr(vendor?.event_opening || "")}" />
    </label>
    <label id="${prefix}-event-ceremony-label" ${showWhen(catKey === "events")}>
      Ceremony (optional)
      <input id="${prefix}-event-ceremony" value="${encodeAttr(vendor?.event_ceremony || "")}" />
    </label>
    <label id="${prefix}-location-type-label" ${showWhen(catKey === "location")}>
      Location type (optional)
      <input id="${prefix}-location-type" placeholder="e.g. Studio, outdoor" value="${encodeAttr(vendor?.location_type || "")}" />
    </label>

    <label>Details (optional)
      <textarea id="${prefix}-details" rows="2">${escapeHtml(vendor?.details || "")}</textarea>
    </label>
  `;
}

/**
 * Toggle the visibility of ID/License + per-category optional fields
 * inside a vendor form when the category picker changes.
 *
 * Called from the global `change` listener — see the
 * `event.target.id.endsWith("-category")` branch.
 */
function syncVendorCategoryVisibility(prefix) {
  const select = document.getElementById(`${prefix}-category`);
  if (!select) return;
  const cat = findVendorCategory(select.value);
  const requiresLicense = !!cat?.requires_license;
  const key = cat?.key || "";
  const setShown = (id, shown) => {
    const el = document.getElementById(id);
    if (el) el.style.display = shown ? "" : "none";
  };
  setShown(`${prefix}-id-label`,             !requiresLicense);
  setShown(`${prefix}-license-label`,        requiresLicense);
  setShown(`${prefix}-location-link-label`,  key === "logistics" || key === "location");
  setShown(`${prefix}-short-address-label`,  key === "logistics");
  setShown(`${prefix}-age-label`,            key === "model");
  setShown(`${prefix}-gender-label`,         key === "model");
  setShown(`${prefix}-rental-type-label`,    key === "rentals");
  setShown(`${prefix}-event-opening-label`,  key === "events");
  setShown(`${prefix}-event-ceremony-label`, key === "events");
  setShown(`${prefix}-location-type-label`,  key === "location");
}

/**
 * Read a vendor form's current values into the shape the
 * /api/vendors/ POST / PATCH endpoints expect. Centralised so
 * createVendor + updateVendor stay tiny.
 */
function readVendorFormPayload(prefix) {
  const val = (suffix) => (getFormValue(`#${prefix}-${suffix}`) || "").trim();
  const ageRaw = val("age");
  const ageNum = ageRaw === "" ? null : Number(ageRaw);
  return {
    name:           val("name"),
    category_id:    val("category") || null,
    id_number:      val("id-number"),
    license_number: val("license"),
    signatory_name: val("signatory"),
    contact_name:   val("contact-name"),
    phone:          val("phone"),
    email:          val("email"),
    vat_number:     val("vat"),
    details:        val("details"),
    location_link:  val("location-link"),
    short_address:  val("short-address"),
    age:            Number.isFinite(ageNum) ? ageNum : null,
    gender:         val("gender"),
    rental_type:    val("rental-type"),
    event_opening:  val("event-opening"),
    event_ceremony: val("event-ceremony"),
    location_type:  val("location-type"),
  };
}

// ────────────────────────────────────────────────────────────────────
// Vendor card expansion + Design C editor modal helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Inline summary block shown under a vendor card when the user
 * clicks it. Reveals every bank, per-category specifics, and notes
 * without leaving the page. Mirrors the PM-app expansion.
 */
function renderVendorCardExpansion(vendor, banks, category) {
  const rows = [];
  if (category) {
    const key = category.key;
    if (key === "influencer" || key === "ugc") rows.push(["Platforms", vendor.platforms]);
    else if (key === "logistics") { rows.push(["Location link", vendor.location_link]); rows.push(["Short address", vendor.short_address]); }
    else if (key === "model") { rows.push(["Age", vendor.age]); rows.push(["Gender", vendor.gender]); }
    else if (key === "rentals") rows.push(["Rental type", vendor.rental_type]);
    else if (key === "events") { rows.push(["Opening", vendor.event_opening]); rows.push(["Ceremony", vendor.event_ceremony]); }
    else if (key === "location") { rows.push(["Location type", vendor.location_type]); rows.push(["Location link", vendor.location_link]); }
  }
  const visibleRows = rows.filter(([, v]) => v != null && String(v).trim() !== "");

  const banksBlock = banks.length > 1 ? `
    <div style="margin-top:10px">
      <div style="font-size:10px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px">All banks</div>
      <ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:3px">
        ${banks.map((b) => `
          <li style="display:flex; justify-content:space-between; gap:8px; font-size:12px">
            <span style="color:var(--muted)">${escapeHtml(b.bank_name || "—")}</span>
            <span style="font-family:monospace">${escapeHtml(b.iban || "—")}</span>
          </li>
        `).join("")}
      </ul>
    </div>
  ` : "";

  const catBlock = visibleRows.length ? `
    <div style="margin-top:10px">
      <div style="font-size:10px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px">${escapeHtml(category.label)} details</div>
      <dl style="display:grid; grid-template-columns:120px 1fr; gap:3px 12px; font-size:12px; margin:0">
        ${visibleRows.map(([k, v]) => `
          <dt style="color:var(--muted)">${escapeHtml(k)}</dt>
          <dd style="margin:0">${escapeHtml(String(v))}</dd>
        `).join("")}
      </dl>
    </div>
  ` : "";

  const notesBlock = vendor.details ? `
    <div style="margin-top:10px">
      <div style="font-size:10px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px">Notes</div>
      <p style="font-size:12px; color:var(--muted); margin:0; white-space:pre-wrap">${escapeHtml(vendor.details)}</p>
    </div>
  ` : "";

  return `
    <div style="margin-top:12px; padding-top:10px; border-top:1px solid var(--line)">
      ${banksBlock}${catBlock}${notesBlock}
    </div>
  `;
}

/**
 * Modal-specific top-fields renderer. Same field set + #vendor-edit-*
 * input ids as the legacy renderVendorFormFields("edit", v) so
 * readVendorFormPayload("vendor-edit") still works unchanged, but
 * deliberately omits bank fields (those live inside the bank tabs).
 *
 * Reacts to a category change via the existing
 * syncVendorCategoryVisibility("vendor-edit") handler — wired in the
 * global `change` listener.
 */
function renderVendorEditorTopFields(vendor) {
  const categories = state.vendorCategories || [];
  // Draft overrides vendor (draft is what the user has typed during
  // this modal session; vendor is the saved state).
  const d = state.vendorEditorDraft || {};
  const valOr = (key, fallback) => d[key] !== undefined ? d[key] : (fallback ?? "");
  const catId = valOr("category", vendor?.category_id || "");
  const cat = findVendorCategory(catId);
  const requiresLicense = !!cat?.requires_license;
  const catKey = cat?.key || "";
  const showWhen = (visible) => `style="${visible ? "" : "display:none"}"`;

  const categoryOptions = `
    <option value="">— select a category —</option>
    ${categories.map((c) => `
      <option value="${encodeAttr(c.id)}" ${c.id === catId ? "selected" : ""}>
        ${escapeHtml(c.label)}
      </option>
    `).join("")}
  `;

  // Pull every field from the draft when present, else from the vendor
  // row, else empty. Selects also honor the draft so a category change
  // mid-session survives a re-render.
  const v_name      = valOr("name", vendor?.name);
  const v_idnum     = valOr("id-number", vendor?.id_number);
  const v_license   = valOr("license", vendor?.license_number);
  const v_signatory = valOr("signatory", vendor?.signatory_name);
  const v_contact   = valOr("contact-name", vendor?.contact_name);
  const v_phone     = valOr("phone", vendor?.phone);
  const v_email     = valOr("email", vendor?.email);
  const v_vat       = valOr("vat", vendor?.vat_number);
  const v_details   = valOr("details", vendor?.details);
  const v_loclink   = valOr("location-link", vendor?.location_link);
  const v_shortaddr = valOr("short-address", vendor?.short_address);
  const v_age       = valOr("age", vendor?.age != null ? String(vendor.age) : "");
  const v_gender    = valOr("gender", vendor?.gender);
  const v_rental    = valOr("rental-type", vendor?.rental_type);
  const v_opening   = valOr("event-opening", vendor?.event_opening);
  const v_ceremony  = valOr("event-ceremony", vendor?.event_ceremony);
  const v_loctype   = valOr("location-type", vendor?.location_type);
  const v_platforms = valOr("platforms", vendor?.platforms);

  return `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px">
      <label>Category <select id="vendor-edit-category" required>${categoryOptions}</select></label>
      <label>Vendor name <input id="vendor-edit-name" required value="${encodeAttr(v_name)}" /></label>

      <label id="vendor-edit-id-label" ${showWhen(!requiresLicense)}>
        ID number
        <input id="vendor-edit-id-number" value="${encodeAttr(v_idnum)}" />
      </label>
      <label id="vendor-edit-license-label" ${showWhen(requiresLicense)}>
        License number
        <input id="vendor-edit-license" value="${encodeAttr(v_license)}" />
      </label>

      <label>Signatory name <input id="vendor-edit-signatory" placeholder="Whose name signs" value="${encodeAttr(v_signatory)}" /></label>
      <label>Contact name <input id="vendor-edit-contact-name" value="${encodeAttr(v_contact)}" /></label>
      <label>Contact phone <input id="vendor-edit-phone" value="${encodeAttr(v_phone)}" /></label>
      <label>Contact email <input id="vendor-edit-email" type="email" value="${encodeAttr(v_email)}" /></label>
      <label>VAT number <input id="vendor-edit-vat" value="${encodeAttr(v_vat)}" /></label>

      <label id="vendor-edit-location-link-label" ${showWhen(catKey === "logistics" || catKey === "location")}>
        Location link
        <input id="vendor-edit-location-link" value="${encodeAttr(v_loclink)}" />
      </label>
      <label id="vendor-edit-short-address-label" ${showWhen(catKey === "logistics")}>
        Short address
        <input id="vendor-edit-short-address" value="${encodeAttr(v_shortaddr)}" />
      </label>
      <label id="vendor-edit-age-label" ${showWhen(catKey === "model")}>
        Age
        <input id="vendor-edit-age" type="number" min="0" value="${encodeAttr(v_age)}" />
      </label>
      <label id="vendor-edit-gender-label" ${showWhen(catKey === "model")}>
        Gender
        <select id="vendor-edit-gender">
          <option value="">—</option>
          <option value="male" ${v_gender === "male" ? "selected" : ""}>Male</option>
          <option value="female" ${v_gender === "female" ? "selected" : ""}>Female</option>
        </select>
      </label>
      <label id="vendor-edit-rental-type-label" ${showWhen(catKey === "rentals")}>
        Rental type
        <input id="vendor-edit-rental-type" value="${encodeAttr(v_rental)}" />
      </label>
      <label id="vendor-edit-event-opening-label" ${showWhen(catKey === "events")}>
        Opening
        <input id="vendor-edit-event-opening" value="${encodeAttr(v_opening)}" />
      </label>
      <label id="vendor-edit-event-ceremony-label" ${showWhen(catKey === "events")}>
        Ceremony
        <input id="vendor-edit-event-ceremony" value="${encodeAttr(v_ceremony)}" />
      </label>
      <label id="vendor-edit-location-type-label" ${showWhen(catKey === "location")}>
        Location type
        <input id="vendor-edit-location-type" value="${encodeAttr(v_loctype)}" />
      </label>

      ${(catKey === "influencer" || catKey === "ugc") ? `
        <label>Platforms <input id="vendor-edit-platforms" value="${encodeAttr(v_platforms)}" placeholder="Instagram, TikTok…" /></label>
      ` : ""}
    </div>
    <label style="display:block; margin-top:8px">Details (optional) <textarea id="vendor-edit-details" rows="2" style="width:100%; resize:vertical">${escapeHtml(v_details)}</textarea></label>
  `;
}

/**
 * Per-slot file uploader for the Design C modal. Lists existing files
 * in the slot, plus an Upload button. Files are stored in the
 * vendor_files table (slot column from migration 032) and the
 * vendor-files Storage bucket. The contract app talks to the FastAPI
 * /api/vendors/.../files endpoints instead of Supabase directly so it
 * keeps a single backend pattern.
 *
 * Create-mode vendors have no vendor_id yet, so the upload button is
 * disabled with a hint to save first.
 */
function renderVendorFileUploader(slot, title) {
  const vendor = state.vendorEditorTarget;
  const isCreate = !vendor;
  const files = isCreate ? [] : vendorEditorFilesInSlot(slot);

  const fileRows = files.map((f) => `
    <li style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:6px 8px; background:var(--panel-strong); border:1px solid var(--line); border-radius:6px">${f.preview_url ? (/\.pdf$/i.test(f.file_name||"") ? '<embed src="'+encodeAttr(f.preview_url)+'" type="application/pdf" style="width:100%;height:460px;border:1px solid var(--line);border-radius:8px;margin-bottom:4px" />' : `<img src="${encodeAttr(f.preview_url)}" data-action="ve-download-file" data-file-id="${encodeAttr(f.id)}" style="width:100%;max-height:360px;object-fit:contain;border-radius:8px;cursor:pointer;margin-bottom:4px" title="Open image" />`) : ""}
      <div style="flex:1; min-width:0">
        <div style="font-size:12px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(f.file_name)}</div>
        <div style="font-size:10px; color:var(--muted)">${(f.file_size / 1024).toFixed(0)} KB · ${new Date(f.uploaded_at).toLocaleString()}</div>
      </div>
      <button type="button" class="ghost-button" data-action="ve-download-file" data-file-id="${encodeAttr(f.id)}" style="padding:3px 8px; font-size:11px">Download</button>
      <button type="button" class="ghost-button" data-action="ve-delete-file" data-file-id="${encodeAttr(f.id)}" style="padding:3px 8px; font-size:11px; color:var(--red)">Delete</button>
    </li>
  `).join("");

  return `
    <div style="border:1px solid var(--line); border-radius:8px; padding:12px; background:var(--canvas)">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px">
        <div>
          <div style="font-weight:700; font-size:12px">${escapeHtml(title)}</div>
          <div style="font-size:11px; color:var(--muted); margin-top:2px">
            ${isCreate
              ? "Save the vendor first to attach files."
              : "Max 25 MB per file. Multiple uploads supported."}
          </div>
        </div>
        ${isCreate ? "" : `
          <label style="display:inline-flex">
            <input type="file" multiple class="ve-file-input" data-slot="${encodeAttr(slot)}" style="display:none" />
            <span class="secondary-button" data-action="ve-trigger-upload" data-slot="${encodeAttr(slot)}" style="padding:5px 10px; font-size:12px; cursor:pointer">+ Upload</span>
          </label>
        `}
      </div>
      <div style="margin-top:10px">
        ${files.length === 0
          ? `<div style="font-size:11px; color:var(--muted); padding:14px 8px; text-align:center; border:1px dashed var(--line); border-radius:6px">No files yet.</div>`
          : `<ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:5px">${fileRows}</ul>`}
      </div>
    </div>
  `;
}

// ── BankDraft helpers ───────────────────────────────────────────────

function bankToDraft(b) {
  return {
    id:             b.id,
    localKey:       `bank:${b.id}`,
    bank_name:      b.bank_name || "",
    account_name:   b.account_name || "",
    iban:           b.iban || "",
    account_number: b.account_number || "",
    swift_code:     b.swift_code || "",
    deleted:        false,
  };
}

function emptyBankDraft() {
  return {
    id:             null,
    localKey:       `new-${Math.random().toString(36).slice(2, 10)}`,
    bank_name:      "",
    account_name:   "",
    iban:           "",
    account_number: "",
    swift_code:     "",
    deleted:        false,
  };
}

/** Open the editor for a specific vendor (or null = create). */
function openVendorEditor(vendor) {
  state.vendorEditorTarget = vendor;
  state.vendorEditorBanks = vendor
    ? (vendor.bank_accounts || []).map(bankToDraft)
    : [];
  state.vendorEditorTab = { type: "id" };
  state.vendorEditorError = "";
  state.vendorEditorFiles = [];
  state.vendorEditorDraft = null;
  state.vendorEditorOpen = true;
  renderVendorsView();
  // Edit mode: load existing files for this vendor (all slots) in the
  // background so the tabs show whatever is already attached. Create
  // mode has no vendor_id yet, so we skip — uploader for those tabs
  // shows a "save the vendor first" hint.
  if (vendor) loadVendorEditorFiles(vendor.id);
}

/** Fetch the vendor's files into state.vendorEditorFiles and repaint. */
async function loadVendorEditorFiles(vendorId) {
  try {
    const files = await api(`/api/vendors/${vendorId}/files`, { body: undefined });
    for (const _f of (Array.isArray(files) ? files : [])) { if (/\.(jpe?g|png|gif|webp|bmp|pdf)$/i.test(_f.file_name || "")) { try { const _d = await api(`/api/vendors/files/${encodeURIComponent(_f.id)}/download`, { body: undefined }); if (_d && _d.url) _f.preview_url = _d.url.replace(/[?&]download=[^&]*/, ""); } catch (_e) {} } }
    if (state.vendorEditorOpen && state.vendorEditorTarget?.id === vendorId) {
      state.vendorEditorFiles = Array.isArray(files) ? files : [];
      renderVendorsView();
    }
  } catch (err) {
    console.error("loadVendorEditorFiles failed:", err);
  }
}

/** Group files by slot for the tab lookup. Mirrors
 *  groupVendorFilesBySlot from the PM-app hook. */
function vendorEditorFilesInSlot(slot) {
  return state.vendorEditorFiles.filter((f) => (f.slot || "") === slot);
}

function closeVendorEditor() {
  state.vendorEditorOpen = false;
  state.vendorEditorTarget = null;
  state.vendorEditorBanks = [];
  state.vendorEditorTab = { type: "id" };
  state.vendorEditorError = "";
  state.vendorEditorDraft = null;
  state.vendorEditorFiles = [];
  renderVendorsView();
}

/**
 * Snapshot the modal's top-field DOM values into state so a re-render
 * (tab switch, add/remove bank) doesn't lose what the user typed.
 * Bank tab inputs are already persisted via the input listener.
 */
function captureVendorEditorTopFields() {
  if (!state.vendorEditorOpen) return;
  const keys = [
    "category", "name", "id-number", "license", "signatory",
    "contact-name", "phone", "email", "vat", "details",
    "location-link", "short-address", "age", "gender",
    "rental-type", "event-opening", "event-ceremony", "location-type",
    "platforms",
  ];
  const draft = state.vendorEditorDraft || {};
  for (const k of keys) {
    const el = document.getElementById(`vendor-edit-${k}`);
    if (el) draft[k] = el.value;
  }
  state.vendorEditorDraft = draft;
}

/**
 * Render the Design C modal markup. Returns "" when closed so the
 * modal lives inside the normal view innerHTML without leaking event
 * listeners. State changes (open/close/tab switch/bank add/remove)
 * call renderVendorsView() to repaint.
 */
/**
 * The names the placeholders get.
 *
 * They must be distinguishable in a dropdown that only shows "name /
 * license", so a row of twenty identical "New vendor" entries would be
 * useless. Numbered from the count already on file, so adding ten more
 * next week continues the run rather than restarting it and producing a
 * second "New vendor 1".
 */
function bulkVendorNames(count, prefix, startAt) {
  const n = Math.max(1, Math.min(100, Math.floor(Number(count) || 0)));
  const base = String(prefix || "").trim() || "New vendor";
  const from = Math.max(1, Math.floor(Number(startAt) || 1));
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(`${base} ${from + i}`);
  return out;
}

/** How many of the existing vendors already use this prefix, so numbering continues. */
function bulkVendorNextNumber(vendors, prefix) {
  const base = (String(prefix || "").trim() || "New vendor").toLowerCase();
  let highest = 0;
  for (const v of vendors || []) {
    const name = String(v?.name || "").trim().toLowerCase();
    if (!name.startsWith(base + " ")) continue;
    const tail = name.slice(base.length + 1).trim();
    const num = Number(tail);
    if (Number.isInteger(num) && num > highest) highest = num;
  }
  return highest + 1;
}

/** What to say when some of them did not make it. */
function bulkVendorResultLine(made, failed) {
  const head = made === 0
    ? "No vendors were created."
    : `Added ${made} vendor${made === 1 ? "" : "s"}.`;
  if (!failed || !failed.length) return head;
  const reasons = [...new Set(failed.map((f) => f.reason))];
  const why = reasons.length === 1 ? reasons[0] : `${reasons.length} different problems`;
  return `${head} ${failed.length} failed — ${why}.`;
}

function renderBulkVendorModal() {
  if (!state.bulkVendorOpen) return "";
  const count = state.bulkVendorCount ?? 10;
  const prefix = state.bulkVendorPrefix ?? "New vendor";
  const startAt = bulkVendorNextNumber(state.vendors, prefix);
  const preview = bulkVendorNames(Math.min(count, 3), prefix, startAt);
  const categoryOptions = (state.vendorCategories || [])
    .map((c) => `<option value="${encodeAttr(c.id)}" ${String(c.id) === String(state.bulkVendorCategory || "") ? "selected" : ""}>${escapeHtml(c.name)}</option>`)
    .join("");

  const progress = state.bulkVendorBusy || state.bulkVendorDone
    ? `<div class="pill" style="margin-top:10px">Created ${state.bulkVendorDone} of ${state.bulkVendorTotal}…</div>`
    : "";
  const errBlock = state.bulkVendorError
    ? `<div class="pill" style="background:#fde2e1; color:#7c1d1c; margin-top:10px">${escapeHtml(state.bulkVendorError)}</div>`
    : "";
  const failedBlock = (state.bulkVendorFailed || []).length
    ? `<div style="margin-top:10px; font-size:12px; color:var(--muted)">
         Did not make it:
         <ul style="margin:4px 0 0; padding-left:18px">
           ${state.bulkVendorFailed.map((f) => `<li>${escapeHtml(f.name)} — ${escapeHtml(f.reason)}</li>`).join("")}
         </ul>
       </div>`
    : "";

  return `
    <div class="modal-backdrop" data-action="bulk-close-bg">
      <div class="modal-panel" data-stop-card-click style="max-width:520px">
        <header style="display:flex; justify-content:space-between; align-items:center; padding:14px 18px; border-bottom:1px solid var(--line)">
          <h3 style="margin:0; font-size:18px">Add several vendors</h3>
          <button type="button" class="ghost-button" data-action="bulk-close" aria-label="Close" style="font-size:18px">×</button>
        </header>
        <div style="flex:1; overflow-y:auto; padding:18px; display:flex; flex-direction:column; gap:14px">
          <p style="margin:0; color:var(--muted); font-size:13px">
            Creates the rows now with a placeholder name so you can fill in the
            real name, ID and bank later. They show as <strong>Incomplete</strong>
            in the directory until they have a name, an ID and an IBAN — filter on
            that to find them again.
          </p>
          <div style="display:grid; grid-template-columns:110px 1fr; gap:10px">
            <label>How many
              <input id="bulk-vendor-count" type="number" min="1" max="100" value="${encodeAttr(String(count))}" />
            </label>
            <label>Category
              <select id="bulk-vendor-category">
                <option value="">Choose a category…</option>
                ${categoryOptions}
              </select>
            </label>
            <label style="grid-column:1 / -1">Name them
              <input id="bulk-vendor-prefix" value="${encodeAttr(prefix)}" placeholder="New vendor" />
            </label>
          </div>
          <div style="font-size:12px; color:var(--muted)">
            They will be called ${preview.map((n) => `<strong>${escapeHtml(n)}</strong>`).join(", ")}${count > 3 ? ", and so on" : ""}.
          </div>
          ${progress}
          ${failedBlock}
          ${errBlock}
        </div>
        <footer style="display:flex; justify-content:flex-end; gap:8px; padding:12px 18px; border-top:1px solid var(--line)">
          <button type="button" class="secondary-button" data-action="bulk-close" ${state.bulkVendorBusy ? "disabled" : ""}>Cancel</button>
          <button type="button" class="primary-button" data-action="bulk-create" ${state.bulkVendorBusy ? "disabled" : ""}>
            ${state.bulkVendorBusy ? "Creating…" : `Create ${bulkVendorNames(count, prefix, startAt).length} vendors`}
          </button>
        </footer>
      </div>
    </div>
  `;
}

/**
 * Create the placeholders.
 *
 * There is no bulk endpoint, so this is N calls — but four at a time
 * rather than one after another, which is the difference between twenty
 * vendors taking a moment and taking most of a minute. Each failure is
 * kept with its reason and named in the modal; the ones that worked are
 * kept, because losing nineteen good rows because the twentieth was
 * refused would be worse.
 */
async function createVendorsBulk() {
  const countEl = document.querySelector("#bulk-vendor-count");
  const prefixEl = document.querySelector("#bulk-vendor-prefix");
  const catEl = document.querySelector("#bulk-vendor-category");
  const count = Number(countEl?.value || 0);
  const prefix = prefixEl?.value || "New vendor";
  const categoryId = catEl?.value || "";

  state.bulkVendorCount = count;
  state.bulkVendorPrefix = prefix;
  state.bulkVendorCategory = categoryId;
  state.bulkVendorError = "";
  state.bulkVendorFailed = [];

  if (!categoryId) {
    state.bulkVendorError = "Pick a category — it decides which details each vendor is asked for.";
    renderVendorsView();
    return;
  }
  const names = bulkVendorNames(count, prefix, bulkVendorNextNumber(state.vendors, prefix));
  if (!names.length) {
    state.bulkVendorError = "How many? It has to be at least one.";
    renderVendorsView();
    return;
  }

  state.bulkVendorBusy = true;
  state.bulkVendorTotal = names.length;
  state.bulkVendorDone = 0;
  renderVendorsView();

  const made = [];
  const failed = [];
  const queue = names.slice();

  const worker = async () => {
    while (queue.length) {
      const name = queue.shift();
      try {
        const created = await api("/api/vendors/", {
          method: "POST",
          body: JSON.stringify({ name, category_id: categoryId }),
        });
        made.push({ ...created, bank_accounts: created.bank_accounts || [] });
      } catch (err) {
        failed.push({ name, reason: (err && err.message) ? String(err.message) : "the server refused it" });
      }
      state.bulkVendorDone += 1;
      // Repaint the count without rebuilding the whole view on every
      // single response — the modal is the only thing that changed.
      const pill = document.querySelector(".modal-panel .pill");
      if (pill && state.bulkVendorBusy) pill.textContent = `Created ${state.bulkVendorDone} of ${state.bulkVendorTotal}…`;
    }
  };

  await Promise.all([worker(), worker(), worker(), worker()]);

  // Newest first, matching what createVendor does for a single one.
  state.vendors = [...made.reverse(), ...state.vendors];
  state.bulkVendorBusy = false;
  state.bulkVendorFailed = failed;
  state.bulkVendorOpen = failed.length > 0;   // stay open only to show what failed
  state.bulkVendorDone = 0;
  renderVendorsView();
  showToast(bulkVendorResultLine(made.length, failed), failed.length ? "error" : "");
}

function renderVendorEditorModal() {
  if (!state.vendorEditorOpen) return "";
  const vendor = state.vendorEditorTarget;
  const isEdit = !!vendor;
  const cat = vendor ? findVendorCategory(vendor.category_id) : null;
  const banks = state.vendorEditorBanks.filter((b) => !b.deleted);
  const activeTab = state.vendorEditorTab;

  // Top-section fields. Reuses the same #vendor-edit-* input ids as
  // the legacy form so readVendorFormPayload("vendor-edit") works,
  // but excludes the bank inputs — those live inside the bank tabs
  // and would visually duplicate otherwise.
  const topFields = renderVendorEditorTopFields(vendor);

  // Active tab label uses category to flip License vs ID.
  const identifierLabel = cat?.requires_license ? "License" : "ID";

  const tabHeader = `
    <div style="display:flex; gap:2px; border-bottom:1px solid var(--line); margin-top:12px; flex-wrap:wrap">
      <button type="button" class="tab-pill ${activeTab.type === "id" ? "is-active" : ""}" data-action="ve-tab" data-tab-type="id">${escapeHtml(identifierLabel)}</button>
      ${banks.map((b, idx) => `
        <button type="button" class="tab-pill ${activeTab.type === "bank" && activeTab.localKey === b.localKey ? "is-active" : ""}" data-action="ve-tab" data-tab-type="bank" data-tab-key="${encodeAttr(b.localKey)}">
          🏦 ${escapeHtml(b.bank_name.trim() || (b.id ? `Bank ${b.id}` : `New bank ${idx + 1}`))}
        </button>
      `).join("")}
      <button type="button" class="tab-pill" data-action="ve-add-bank" style="color:var(--muted)">+ Add bank</button>
    </div>
  `;

  let tabBody = "";
  if (activeTab.type === "id") {
    const idSlot = cat?.requires_license ? "license" : "id";
    tabBody = `
      <div style="display:flex; flex-direction:column; gap:12px">
        ${renderVendorFileUploader(idSlot, `${identifierLabel} document`)}
      </div>
    `;
  } else {
    const b = banks.find((x) => x.localKey === activeTab.localKey);
    if (b) {
      // Files anchor to the bank's real id. New banks (no id yet) get
      // a placeholder uploader telling the user to save first — any
      // files uploaded against a placeholder slot would orphan when
      // the bank is created with a different id.
      const bankSlotKey = b.id != null ? `bank:${b.id}` : null;
      const fileBlock = bankSlotKey
        ? renderVendorFileUploader(bankSlotKey, "Bank document")
        : `<div style="border:1px dashed var(--line); border-radius:8px; padding:14px; text-align:center; color:var(--muted); font-size:11px">
             Save the vendor first to attach a document to this new bank.
           </div>`;
      tabBody = `
        <div style="display:flex; flex-direction:column; gap:12px">
          ${fileBlock}
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px">
            <label>Bank name <input class="ve-bank-input" data-field="bank_name" data-key="${encodeAttr(b.localKey)}" value="${encodeAttr(b.bank_name)}" /></label>
            <label>Account name <input class="ve-bank-input" data-field="account_name" data-key="${encodeAttr(b.localKey)}" value="${encodeAttr(b.account_name)}" /></label>
            <label style="grid-column: 1 / -1">IBAN <input class="ve-bank-input" data-field="iban" data-key="${encodeAttr(b.localKey)}" value="${encodeAttr(b.iban)}" placeholder="SA…" /></label>
            <label>Account number <input class="ve-bank-input" data-field="account_number" data-key="${encodeAttr(b.localKey)}" value="${encodeAttr(b.account_number)}" /></label>
            <label>SWIFT <input class="ve-bank-input" data-field="swift_code" data-key="${encodeAttr(b.localKey)}" value="${encodeAttr(b.swift_code)}" /></label>
          </div>
          <div style="display:flex; justify-content:flex-end">
            <button type="button" class="ghost-button" data-action="ve-remove-bank" data-key="${encodeAttr(b.localKey)}" style="color:var(--red); font-size:12px">Remove this bank</button>
          </div>
        </div>
      `;
    }
  }

  const errBlock = state.vendorEditorError
    ? `<div class="pill" style="background:#fde2e1; color:#7c1d1c; margin-top:10px">${escapeHtml(state.vendorEditorError)}</div>`
    : "";

  return `
    <div class="modal-backdrop" data-action="ve-close-bg">
      <div class="modal-panel" data-stop-card-click>
        <header style="display:flex; justify-content:space-between; align-items:center; padding:14px 18px; border-bottom:1px solid var(--line)">
          <h3 style="margin:0; font-size:18px">${isEdit ? `Edit ${escapeHtml(vendor.name)}` : "New vendor"}</h3>
          <button type="button" class="ghost-button" data-action="ve-close" aria-label="Close" style="font-size:18px">×</button>
        </header>
        <div style="flex:1; overflow-y:auto; padding:18px; display:flex; flex-direction:column; gap:14px">
          ${topFields}
          ${tabHeader}
          <div style="padding-top:10px">${tabBody}</div>
          ${errBlock}
        </div>
        <footer style="display:flex; justify-content:flex-end; gap:8px; padding:12px 18px; border-top:1px solid var(--line)">
          <button type="button" class="secondary-button" data-action="ve-close" ${state.vendorEditorSaving ? "disabled" : ""}>Cancel</button>
          <button type="button" class="primary-button" data-action="ve-save" ${state.vendorEditorSaving ? "disabled" : ""}>
            ${state.vendorEditorSaving ? "Saving…" : (isEdit ? "Save changes" : "Add vendor")}
          </button>
        </footer>
      </div>
    </div>
  `;
}

function renderVendorsView() {
  updateHeader("Vendors", "Manage vendors, bank accounts, and onboarding");
  const vendorQuery = state.vendorSearch.trim().toLowerCase();
  const vExp = expiryByLicense();
  const filteredVendors = state.vendors.filter((vendor) => {
    // Search — name, ID, license, id_number, signatory/contact, email,
    // phone, VAT, platforms, plus any bank IBAN/name/number.
    if (vendorQuery) {
      const fields = [
        vendor.name, vendor.id, vendor.license_number, vendor.id_number,
        vendor.signatory_name, vendor.contact_name, vendor.contact_email,
        vendor.email, vendor.phone, vendor.vat_number, vendor.platforms,
      ];
      const inFields = fields.some((v) => String(v || "").toLowerCase().includes(vendorQuery))
        || (vendor.bank_accounts || []).some((bank) =>
          String(bank.iban || "").toLowerCase().includes(vendorQuery)
          || String(bank.account_name || "").toLowerCase().includes(vendorQuery)
          || String(bank.account_number || "").toLowerCase().includes(vendorQuery));
      if (!inFields) return false;
    }
    // Type (category) filter
    if (state.vendorTypeFilter && String(vendor.category_id || "") !== String(state.vendorTypeFilter)) return false;
    // License status filter (expired / expiring / valid / none)
    if (state.vendorLicenseFilter && vendorLicenseStatus(vendor, vExp) !== state.vendorLicenseFilter) return false;
    // Completeness filter
    if (state.vendorCompleteFilter) {
      const complete = vendorIsComplete(vendor);
      if (state.vendorCompleteFilter === "complete" && !complete) return false;
      if (state.vendorCompleteFilter === "incomplete" && complete) return false;
    }
    return true;
  });
  // Right-side detail panel stays blank until the user explicitly picks a
  // vendor. If a stale localStorage id no longer matches any vendor (e.g.,
  // after a DB reset), clear it so the UI doesn't show ghost data.
  if (state.selectedVendorId
      && !state.vendors.find((v) => String(v.id) === String(state.selectedVendorId))) {
    state.selectedVendorId = "";
    state.selectedBankId = "";
    localStorage.removeItem("aq_selected_vendor");
  }
  const vendor = selectedVendor();
  const selectedBank = vendor ? (findBank(vendor, state.selectedBankId) || (vendor.bank_accounts || [])[0] || null) : null;
  if (selectedBank) state.selectedBankId = String(selectedBank.id);
  else state.selectedBankId = "";
  // When no vendor is selected, lead the dropdown with a placeholder so the
  // right-side panel does not show a vendor that the user did not pick.
  const placeholderOption = `<option value="" ${vendor ? "" : "selected"} disabled>Choose a vendor...</option>`;
  const vendorOptions = placeholderOption + state.vendors.map((item) => `<option value="${item.id}" ${String(item.id) === String(vendor?.id) ? "selected" : ""}>${escapeHtml(item.name)} / ${escapeHtml(item.license_number)}</option>`).join("");
  const bankOptions = (vendor?.bank_accounts || []).map((bank) => `
    <option value="${bank.id}" ${String(bank.id) === String(selectedBank?.id) ? "selected" : ""}>${escapeHtml(bank.iban)} / ${escapeHtml(bank.bank_name)}</option>
  `).join("");
  // Directory rendered as a flat grid table (replaced the click-to-expand
  // cards in the redesign). Edit opens the same modal as before; the banks
  // live inside that editor, so the row stays a single line.
  const dirCols = "minmax(150px,1.5fr) 150px 130px 150px minmax(140px,1fr) 110px 96px";
  const vendorRows = filteredVendors.map((item) => {
    const cat = findVendorCategory(item.category_id);
    const idValue = cat?.requires_license
      ? (item.license_number || item.id_number || "")
      : (item.id_number || item.license_number || "");
    const banks = item.bank_accounts || [];
    const em = (v) => v ? escapeHtml(v) : `<span class="cs-empty">—</span>`;
    return `
      <div class="cs-row" style="grid-template-columns:${dirCols};">
        <div style="min-width:0;">
          <div class="cs-bidi" style="font-size:13.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.name || "—")}</div>
          <div class="cs-cell-id" style="margin-top:2px;">${escapeHtml(item.id)}</div>
        </div>
        <div class="cs-mono" style="font-size:12.5px;color:var(--cs-monoink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${em(idValue)}</div>
        <div style="font-size:13px;color:var(--cs-ink2);">${em(item.phone)}</div>
        <div style="font-size:13px;color:var(--cs-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${em(banks[0]?.bank_name)}</div>
        <div class="cs-mono" style="font-size:12px;color:var(--cs-monoink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${em(banks[0]?.iban)}</div>
        <div><span class="cs-pill">APPROVED</span></div>
        <div class="cs-rowact">
          <button class="cs-iconbtn" type="button" data-action="edit-vendor" data-id="${item.id}">Edit</button>
          <button class="cs-iconbtn is-danger" type="button" data-action="delete-vendor" data-id="${item.id}">Delete</button>
        </div>
      </div>`;
  }).join("");

  els.viewRoot.innerHTML = `
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-bottom:18px;">
      <button class="cs-btn-ghost" type="button" data-action="load-vendors">Refresh</button>
      <button class="cs-btn-ghost" type="button" data-action="open-bulk-vendors">+ Add Several</button>
      <button class="cs-btn" type="button" data-action="open-new-vendor">+ Add Vendor</button>
    </div>

    <section class="cs-kpi-strip cols-3" style="margin-bottom:22px;">
      <div class="cs-kpi is-tile">
        <div class="cs-kpi-label">Approved Vendors</div>
        <div class="cs-kpi-num">${state.vendors.length.toLocaleString()}</div>
        <div class="cs-kpi-sub">in the directory</div>
      </div>
      <div class="cs-kpi">
        <div class="cs-kpi-label">Pending Vendors</div>
        <div class="cs-kpi-num">${state.pendingVendors.length.toLocaleString()}</div>
        <div class="cs-kpi-sub">${isAdmin() ? "awaiting approval" : "admin only"}</div>
      </div>
      <div class="cs-kpi">
        <div class="cs-kpi-label">Expiry Alerts</div>
        <div class="cs-kpi-num">${state.expiryAlerts.length.toLocaleString()}</div>
        <div class="cs-kpi-sub">${isAdmin() ? "licenses expiring" : "admin only"}</div>
      </div>
    </section>

    <div class="cs-card-flush" style="margin-bottom:22px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:18px 22px 16px;flex-wrap:wrap;">
        <div>
          <div class="cs-section-title">Vendor directory</div>
          <div style="font-size:12.5px;color:var(--cs-muted);margin-top:3px;">${filteredVendors.length} of ${state.vendors.length} vendors</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
          <div class="cs-search"><span class="cs-search-ring"></span><input id="vendor-search" placeholder="Search name, ID, license, email, IBAN…" value="${encodeAttr(state.vendorSearch)}" style="width:260px;" /></div>
          ${filterSelect("vendor-type-filter", state.vendorTypeFilter, [["", "All types"], ...(state.vendorCategories || []).map((c) => [c.id, c.label])])}
          ${filterSelect("vendor-license-filter", state.vendorLicenseFilter, [["", "License: all"], ["expired", "Expired"], ["expiring", "Expiring soon"], ["valid", "Valid"], ["none", "No license"]])}
          ${filterSelect("vendor-complete-filter", state.vendorCompleteFilter, [["", "Info: all"], ["complete", "Complete"], ["incomplete", "Incomplete"]])}
          ${clearFiltersChip(state.vendorTypeFilter || state.vendorLicenseFilter || state.vendorCompleteFilter)}
        </div>
      </div>
      <div class="cs-thead" style="grid-template-columns:${dirCols};">
        <div>Vendor</div><div>License / ID</div><div>Phone</div><div>Bank</div><div>IBAN</div><div>Status</div><div></div>
      </div>
      ${vendorRows || `<div class="cs-table-note">No vendors found.</div>`}
      <div class="cs-table-note">${filteredVendors.length} vendor${filteredVendors.length === 1 ? "" : "s"} shown</div>
    </div>

    ${renderPendingPanel("vendors")}
    ${renderVendorEditorModal()}
    ${renderBulkVendorModal()}
  `;
}

/**
 * Clients view — split out of renderVendorsView on 2026-06-11. Same
 * sub-pieces (stats row, directory + side forms, pending panel) but
 * scoped to client data only. Keeps a much cleaner sidebar with
 * Vendors and Clients as separate destinations.
 */
function renderClientsView() {
  updateHeader("Clients", "Manage client master records, signatories, and onboarding");

  // ── Client directory data ──
  const clientQuery = state.clientSearch.trim().toLowerCase();
  const filteredClients = state.clients.filter((c) => {
    if (clientQuery && ![
      c.company_name, c.name, c.id, c.cr_number, c.vat_number,
      c.signatory_name, c.contact_name, c.contact_email, c.company_email,
      c.contact_phone, c.phone, c.city, c.country,
    ].some((v) => String(v || "").toLowerCase().includes(clientQuery))) return false;
    // CR filter
    if (state.clientCrFilter) {
      const hasCr = !!String(c.cr_number || "").trim();
      if (state.clientCrFilter === "has" && !hasCr) return false;
      if (state.clientCrFilter === "missing" && hasCr) return false;
    }
    return true;
  });

  if (state.selectedClientId
      && !state.clients.find((c) => String(c.id) === String(state.selectedClientId))) {
    state.selectedClientId = "";
    localStorage.removeItem("aq_selected_client");
  }
  const client = selectedClient();

  const clientCols = "minmax(160px,1.4fr) 150px 120px 160px 150px 96px";
  const missingCr = state.clients.filter((c) => !c.cr_number).length;
  const clientRows = filteredClients.map((c) => {
    const isSel = String(c.id) === String(client?.id);
    const em = (v) => v ? escapeHtml(v) : `<span class="cs-empty">—</span>`;
    const loc = [c.city, c.country].filter(Boolean).map(escapeHtml).join(", ");
    return `
      <div class="cs-row ${isSel ? "is-selected" : ""}" data-client-row data-id="${c.id}" style="grid-template-columns:${clientCols}; cursor:pointer;">
        <div class="cs-bidi" style="font-size:13.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(c.company_name || c.name || "—")}</div>
        <div class="cs-mono" style="font-size:12.5px;${c.cr_number ? "color:var(--cs-monoink);" : "color:var(--cs-accent);"}">${c.cr_number ? escapeHtml(c.cr_number) : "No CR"}</div>
        <div class="cs-mono" style="font-size:12.5px;color:var(--cs-monoink);">${em(c.vat_number)}</div>
        <div class="cs-bidi" style="font-size:13px;color:var(--cs-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${em(c.signatory_name)}</div>
        <div style="font-size:13px;color:var(--cs-ink2);">${loc || `<span class="cs-empty">—</span>`}</div>
        <div class="cs-rowact">
          <button class="cs-iconbtn" type="button" data-action="select-client" data-id="${c.id}">Edit</button>
        </div>
      </div>`;
  }).join("");

  els.viewRoot.innerHTML = `
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-bottom:18px;">
      <button class="cs-btn-ghost" type="button" data-action="refresh-clients">Refresh</button>
    </div>

    <section class="cs-kpi-strip cols-3" style="margin-bottom:22px;">
      <div class="cs-kpi is-tile">
        <div class="cs-kpi-label">Approved Clients</div>
        <div class="cs-kpi-num">${state.clients.length.toLocaleString()}</div>
        <div class="cs-kpi-sub">in the directory</div>
      </div>
      <div class="cs-kpi">
        <div class="cs-kpi-label">Pending Clients</div>
        <div class="cs-kpi-num">${state.pendingClients.length.toLocaleString()}</div>
        <div class="cs-kpi-sub">${isAdmin() ? "awaiting approval" : "admin only"}</div>
      </div>
      <div class="cs-kpi">
        <div class="cs-kpi-label">Missing CR</div>
        <div class="cs-kpi-num" style="color:${missingCr ? "var(--cs-accent)" : "inherit"};">${missingCr.toLocaleString()}</div>
        <div class="cs-kpi-sub">no commercial registration</div>
      </div>
    </section>

    <div class="cs-card-flush" style="margin-bottom:22px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:18px 22px 16px;flex-wrap:wrap;">
        <div>
          <div class="cs-section-title">Client directory</div>
          <div style="font-size:12.5px;color:var(--cs-muted);margin-top:3px;">${filteredClients.length} of ${state.clients.length} clients</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
          <div class="cs-search"><span class="cs-search-ring"></span><input id="client-search" placeholder="Search company, CR, VAT, signatory, email…" value="${encodeAttr(state.clientSearch)}" style="width:280px;" /></div>
          ${filterSelect("client-cr-filter", state.clientCrFilter, [["", "CR: all"], ["has", "Has CR"], ["missing", "Missing CR"]])}
          ${clearFiltersChip(state.clientCrFilter)}
        </div>
      </div>
      <div class="cs-thead" style="grid-template-columns:${clientCols};">
        <div>Company</div><div>CR Number</div><div>VAT</div><div>Signatory</div><div>Location</div><div></div>
      </div>
      ${clientRows || `<div class="cs-table-note">No clients found.</div>`}
      <div class="cs-table-note">${filteredClients.length} client${filteredClients.length === 1 ? "" : "s"} shown</div>
    </div>

    <section style="display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start;">
        <form id="client-edit-form" class="side-panel">
          <h2>${client ? "Edit client" : "Select a client"}</h2>
          <label>Company Name <input id="client-edit-company" required value="${encodeAttr(client?.company_name || client?.name || "")}" ${client ? "" : "disabled"} /></label>
          <label>CR Number <input id="client-edit-cr" value="${encodeAttr(client?.cr_number || "")}" ${client ? "" : "disabled"} /></label>
          <label>VAT Number <input id="client-edit-vat" value="${encodeAttr(client?.vat_number || "")}" ${client ? "" : "disabled"} /></label>
          <label>Signatory Name <input id="client-edit-signatory" value="${encodeAttr(client?.signatory_name || "")}" ${client ? "" : "disabled"} /></label>
          <label>Phone <input id="client-edit-phone" value="${encodeAttr(client?.contact_phone || client?.phone || "")}" ${client ? "" : "disabled"} /></label>
          <label>Email <input id="client-edit-email" type="email" value="${encodeAttr(client?.contact_email || client?.email || "")}" ${client ? "" : "disabled"} /></label>
          <label>Company Email <input id="client-edit-company-email" type="email" value="${encodeAttr(client?.company_email || "")}" ${client ? "" : "disabled"} /></label>
          <label>Street <input id="client-edit-street" value="${encodeAttr(client?.street || "")}" ${client ? "" : "disabled"} /></label>
          <label>City <input id="client-edit-city" value="${encodeAttr(client?.city || "")}" ${client ? "" : "disabled"} /></label>
          <label>Postcode <input id="client-edit-postcode" value="${encodeAttr(client?.postcode || "")}" ${client ? "" : "disabled"} /></label>
          <label>Country <input id="client-edit-country" value="${encodeAttr(client?.country || "")}" ${client ? "" : "disabled"} /></label>
          <label>National Address <input id="client-edit-national" value="${encodeAttr(client?.national_address || "")}" ${client ? "" : "disabled"} /></label>
          <div class="button-row">
            <button class="primary-button" type="submit" ${client ? "" : "disabled"}>Save Client</button>
            <button class="danger-button" type="button" data-action="delete-client" ${client ? "" : "disabled"}>Delete Client</button>
          </div>
        </form>

        <form id="client-form" class="side-panel">
          <h2>New Client</h2>
          <label>Company Name <input id="new-client-company" required /></label>
          <label>CR Number <input id="new-client-cr" /></label>
          <label>VAT Number <input id="new-client-vat" /></label>
          <label>Signatory Name <input id="new-client-signatory" /></label>
          <label>Phone <input id="new-client-phone" /></label>
          <label>Email <input id="new-client-email" type="email" /></label>
          <label>Company Email <input id="new-client-company-email" type="email" /></label>
          <label>Street <input id="new-client-street" /></label>
          <label>City <input id="new-client-city" /></label>
          <label>Postcode <input id="new-client-postcode" /></label>
          <label>Country <input id="new-client-country" /></label>
          <label>National Address <input id="new-client-national" /></label>
          <button class="primary-button" type="submit">Create Client</button>
        </form>
    </section>

    ${renderPendingPanel("clients")}
  `;
}

/**
 * Onboarding queue for the Vendors or Clients view.
 *
 * `scope`:
 *   "vendors" → Pending Vendors + Expiry Monitor
 *   "clients" → Pending Clients
 *
 * Defaults to "vendors" so any old call sites keep working. The split
 * (separate Vendors and Clients views) landed 2026-06-11.
 */
function renderPendingPanel(scope = "vendors") {
  if (!isAdmin()) {
    const lead = scope === "clients"
      ? "Pending clients and approval actions require an admin account."
      : "Pending vendors, expiry alerts, and approval actions require an admin account.";
    return `
      <section class="glass-panel">
        <div class="panel-header"><h2>Onboarding Queue</h2></div>
        <p class="empty-note">${lead}</p>
      </section>
    `;
  }

  if (scope === "clients") {
    const pendingClientRows = state.pendingClients.map((item) => `
      <tr>
        <td>${escapeHtml(item.company_name)}</td>
        <td>${escapeHtml(item.cr_number)}</td>
        <td>${escapeHtml(item.signatory_name)}</td>
        <td>${escapeHtml(item.email || item.company_email)}</td>
        <td>
          <button class="mini-button" data-action="approve-client" data-id="${item.id}">Approve</button>
          <button class="mini-button danger-text" data-action="reject-client" data-id="${item.id}">Reject</button>
        </td>
      </tr>
    `).join("");

    return `
      <section class="glass-panel">
        <div class="panel-header"><h2>Onboarding Queue</h2></div>
        <div class="queue-grid">
          <div>
            <h3>Pending Clients</h3>
            ${simpleTable(["Company", "CR", "Signatory", "Email", "Actions"], pendingClientRows)}
          </div>
        </div>
      </section>
    `;
  }

  // Vendors scope (default): pending vendor onboarding + expiring licenses.
  const pendingVendorRows = state.pendingVendors.map((item) => `
    <tr>
      <td>${escapeHtml(item.full_name)}</td>
      <td>${escapeHtml(item.license_number)}</td>
      <td>${escapeHtml(item.iban)}</td>
      <td>${escapeHtml(item.platforms)}</td>
      <td>
        <button class="mini-button" data-action="approve-vendor" data-id="${item.id}">Approve</button>
        <button class="mini-button danger-text" data-action="reject-vendor" data-id="${item.id}">Reject</button>
      </td>
    </tr>
  `).join("");

  const expiryRows = state.expiryAlerts.map((item) => `
    <tr>
      <td>${escapeHtml(item.vendor_name)}</td>
      <td>${escapeHtml(item.license_number)}</td>
      <td>${escapeHtml(item.license_expiry)}</td>
      <td>${pill(`${item.days_until_expiry} days`, item.urgency === "expired" ? "hold" : "warn")}</td>
    </tr>
  `).join("");

  return `
    <section class="glass-panel">
      <div class="panel-header"><h2>Onboarding Queue</h2></div>
      <div class="queue-grid">
        <div>
          <h3>Pending Vendors</h3>
          ${simpleTable(["Name", "License", "IBAN", "Platforms", "Actions"], pendingVendorRows)}
        </div>
        <div>
          <h3>Expiry Monitor</h3>
          ${simpleTable(["Vendor", "License", "Expiry", "Urgency"], expiryRows)}
        </div>
      </div>
    </section>
  `;
}

function simpleTable(headers, rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${headers.length}">No records</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderContractsView() {
  updateHeader("Contracts", "Generate DOCX/PDF contracts and manage the generated archive");

  // Group contracts by task_id. Layout (c): outer header shows task brand +
  // a representative license/person; each contract sub-row labelled by
  // brand and contract_id. Click the header to expand/collapse.
  const expanded = state.expandedTasks || (state.expandedTasks = new Set());
  const tasksById = new Map(state.tasks.map((t) => [String(t.id), t]));

  // License → person name lookup, built from the vendor directory. Used so a
  // contract row shows WHO it was made for (e.g. the influencer / UGC license
  // holder) rather than a bare "—" when the stored vendor_name is empty.
  const licenseToName = {};
  for (const v of state.vendors) {
    const lic = String(v.license_number || "").trim().toLowerCase();
    const idn = String(v.id_number || "").trim().toLowerCase();
    if (lic && !licenseToName[lic]) licenseToName[lic] = v.name;
    if (idn && !licenseToName[idn]) licenseToName[idn] = v.name;
  }
  const nameForContract = (c) =>
    c.vendor_name
    || licenseToName[String(c.license_number || "").trim().toLowerCase()]
    || c.client_name
    || c.signatory_name
    || "—";

  // Multi-field contract search — applied BEFORE grouping so task groups
  // disappear cleanly when none of their contracts match.
  const contractQuery = (state.contractSearch || "").trim().toLowerCase();
  const matchingContracts = state.contracts.filter((c) => {
    if (contractQuery && ![
      c.contract_id, c.vendor_name, c.client_name, c.signatory_name,
      c.brand_name, c.license_number, c.contract_type, c.task_id,
      c.iban, c.account_name, c.cr_number,
    ].some((v) => String(v || "").toLowerCase().includes(contractQuery))) return false;
    // Files filter
    if (state.contractFilesFilter === "both" && !c.pdf_path) return false;
    if (state.contractFilesFilter === "docx" && c.pdf_path) return false;
    return true;
  });

  const grouped = new Map();
  matchingContracts.forEach((c) => {
    const key = c.task_id || "(no task)";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(c);
  });

  const taskCards = Array.from(grouped.entries()).map(([taskId, contracts]) => {
    const isOpen = expanded.has(String(taskId));
    const task = tasksById.get(String(taskId));
    const headerBrand = task?.brand || contracts[0]?.brand_name || "";
    // Group header = the date the contracts were generated + the brand name.
    const headerDate = String(contracts[0]?.generated_at || "").slice(0, 10) || "—";

    const adminOnly = isAdmin();
    const contractRows = isOpen ? contracts.map((c) => {
      const hasPdf = Boolean(c.pdf_path);
      const pdfTitle = c.pdf_error ? ` title="PDF unavailable: ${encodeAttr(c.pdf_error)}"` : "";
      // Who the contract was made for: stored vendor/client name, else the
      // license holder's name from the vendor directory (influencer / UGC).
      const contractName = nameForContract(c);
      return `
        <tr class="archive-row">
          <td>
            <strong>${escapeHtml(contractName)}</strong>
            <div style="font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;color:var(--text-muted)">
              ${escapeHtml(c.contract_id)}
            </div>
          </td>
          <td>${escapeHtml(c.brand_name)}</td>
          <td>${money(c.amount)}</td>
          <td>${escapeHtml(c.contract_type)}</td>
          <td>${escapeHtml(c.generated_at)}</td>
          <td>${hasPdf ? pill("DOCX + PDF", "done") : pill("DOCX only", "warn")}</td>
          <td class="actions-cell">
            ${hasPdf
              ? `<button class="mini-button" data-action="download-pdf" data-id="${encodeAttr(c.contract_id)}">PDF</button>`
              : `<button class="mini-button" disabled${pdfTitle}>PDF ✗</button>`}
            <button class="mini-button" data-action="download-docx" data-id="${encodeAttr(c.contract_id)}">DOCX</button>
            <button class="mini-button" data-action="regenerate-contract" data-id="${encodeAttr(c.contract_id)}" title="Re-render this contract from the source task + subtask">Regen</button>
            ${adminOnly
              ? `<button class="mini-button" data-action="replace-contract" data-id="${encodeAttr(c.contract_id)}" title="Upload an edited PDF or DOCX to replace this version">Replace</button>`
              : ""}
            ${adminOnly
              ? `<button class="mini-button danger" data-action="delete-contract" data-id="${encodeAttr(c.contract_id)}">Delete</button>`
              : ""}
          </td>
        </tr>
      `;
    }).join("") : "";

    return `
      <div class="task-group ${isOpen ? "open" : ""}">
        <div class="task-group-header" data-action="toggle-task-group" data-task-id="${encodeAttr(taskId)}">
          <div class="task-group-title">
            <span class="task-group-caret">${isOpen ? "▾" : "▸"}</span>
            <strong class="cs-mono">${escapeHtml(headerDate)}</strong>
            ${headerBrand ? `<span class="task-group-brand cs-bidi">${escapeHtml(headerBrand)}</span>` : ""}
          </div>
          <div class="task-group-meta">
            <span class="task-group-count">${contracts.length} contract${contracts.length === 1 ? "" : "s"}</span>
            <button class="mini-button" data-action="download-all-task" data-task-id="${encodeAttr(taskId)}" data-stop="1">Download all</button>
            ${adminOnly
              ? `<button class="mini-button danger" data-action="delete-task-contracts" data-task-id="${encodeAttr(taskId)}" data-stop="1">Delete all</button>`
              : ""}
          </div>
        </div>
        ${isOpen ? simpleTable(
          ["Name / ID", "Brand", "Amount", "Type", "Generated", "Status", "Actions"],
          contractRows,
        ) : ""}
      </div>
    `;
  }).join("");

  els.viewRoot.innerHTML = `
    <section class="cs-kpi-strip cols-3" style="margin-bottom:22px;">
      <div class="cs-kpi is-tile">
        <div class="cs-kpi-label">Generated</div>
        <div class="cs-kpi-num">${state.contracts.length.toLocaleString()}</div>
        <div class="cs-kpi-sub">archived contracts</div>
      </div>
      <div class="cs-kpi">
        <div class="cs-kpi-label">Templates</div>
        <div class="cs-kpi-num">${state.templates.length.toLocaleString()}</div>
        <div class="cs-kpi-sub">available slots</div>
      </div>
      <div class="cs-kpi">
        <div class="cs-kpi-label">Tasks</div>
        <div class="cs-kpi-num">${state.tasks.length.toLocaleString()}</div>
        <div class="cs-kpi-sub">total campaigns</div>
      </div>
    </section>

    <div class="cs-card" style="margin-bottom:18px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;">
        <div class="cs-section-title">Archive</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
          <div class="cs-search"><span class="cs-search-ring"></span><input id="contract-search" placeholder="Search contract id, vendor, license, brand, CR…" value="${encodeAttr(state.contractSearch)}" style="width:300px;" /></div>
          ${filterSelect("contract-files-filter", state.contractFilesFilter, [["", "Files: all"], ["both", "DOCX + PDF"], ["docx", "DOCX only"]])}
          ${clearFiltersChip(state.contractFilesFilter)}
          <button class="cs-btn-ghost" data-action="refresh-contracts" type="button">Refresh</button>
        </div>
      </div>
    </div>
    ${state.contracts.length === 0
      ? `<div class="cs-card"><p class="empty-note">No generated contracts yet.</p></div>`
      : (taskCards || `<div class="cs-card"><p class="empty-note">No contracts match your search.</p></div>`)}
  `;
}

/**
 * Context-aware Excel export. The top-bar Export button exports whatever
 * page you're on (Vendors → the vendors sheet, Clients → clients, etc.);
 * on the overview pages it exports the whole workbook. Every field lands in
 * its own column — for vendors that means all per-category fields plus each
 * bank account broken out into its own columns. Uses SheetJS so Arabic
 * exports cleanly as a real .xlsx.
 */
async function exportCurrentView() {
  if (typeof XLSX === "undefined") {
    showToast("Excel library is still loading — try again in a second.", "error");
    return;
  }
  try { if (!state.tasks.length || !state.vendors.length || !state.clients.length) await refreshAll(); } catch (_) {}

  // license/id → vendor name, to fill "who" on contracts with a blank name.
  const licenseToName = {};
  for (const v of state.vendors) {
    const lic = String(v.license_number || "").trim().toLowerCase();
    const idn = String(v.id_number || "").trim().toLowerCase();
    if (lic && !licenseToName[lic]) licenseToName[lic] = v.name;
    if (idn && !licenseToName[idn]) licenseToName[idn] = v.name;
  }
  const whoFor = (c) =>
    c.vendor_name || licenseToName[String(c.license_number || "").trim().toLowerCase()]
    || c.client_name || c.signatory_name || "";

  // ── Wide row builders (every field its own column) ──
  const vendorRows = () => {
    const vs = state.vendors || [];
    // How many bank-account column groups we need (max across all vendors).
    const maxBanks = vs.reduce((m, v) => Math.max(m, (v.bank_accounts || []).length), 0);
    return vs.map((v) => {
      const cat = findVendorCategory(v.category_id);
      const banks = v.bank_accounts || [];
      const row = {
        "Vendor ID": v.id ?? "",
        "Name": v.name || "",
        "Category": cat?.label || "",
        "Category Key": cat?.key || "",
        "Requires License": cat?.requires_license ? "Yes" : "No",
        "License Number": v.license_number || "",
        "ID Number": v.id_number || "",
        "Signatory Name": v.signatory_name || "",
        "Contact Name": v.contact_name || "",
        "Email": v.email || "",
        "Phone": v.phone || "",
        "VAT Number": v.vat_number || "",
        "Platforms": v.platforms || "",
        "Age": v.age ?? "",
        "Gender": v.gender || "",
        "Rental Type": v.rental_type || "",
        "Event Opening": v.event_opening || "",
        "Event Ceremony": v.event_ceremony || "",
        "Location Type": v.location_type || "",
        "Location Link": v.location_link || "",
        "Short Address": v.short_address || "",
        "Details": v.details || "",
        "Bank Count": banks.length,
        "Created": v.created_at || "",
      };
      for (let i = 0; i < maxBanks; i++) {
        const b = banks[i] || {};
        const n = i + 1;
        row[`Bank ${n} Name`] = b.bank_name || "";
        row[`Bank ${n} Account Name`] = b.account_name || "";
        row[`Bank ${n} IBAN`] = b.iban || "";
        row[`Bank ${n} Account Number`] = b.account_number || "";
        row[`Bank ${n} SWIFT`] = b.swift_code || "";
      }
      return row;
    });
  };

  const clientRows = () => (state.clients || []).map((c) => ({
    "Client ID": c.id ?? "",
    "Company": c.company_name || c.name || "",
    "CR Number": c.cr_number || "",
    "VAT Number": c.vat_number || "",
    "Signatory Name": c.signatory_name || "",
    "Signatory Title": c.signatory_title || "",
    "Contact Name": c.contact_name || "",
    "Phone": c.contact_phone || c.phone || "",
    "Email": c.contact_email || c.email || "",
    "Company Email": c.company_email || "",
    "Street": c.street || "",
    "City": c.city || "",
    "Postcode": c.postcode || "",
    "Country": c.country || "",
    "National Address": c.national_address || "",
    "Created": c.created_at || "",
  }));

  const taskRows = () => (state.tasks || []).map((t) => ({
    "Task ID": t.id || "",
    "Brand": t.brand || "",
    "Amount": t.amount || "",
    "Status": t.status || "",
    "Contract Type": t.contract_type || "",
    "Contract Length (days)": t.duration || "",
    "Due Date": t.end_date || "",
    "Subtasks": Number(t.subtask_count || 0),
    "Paid": Number(t.paid_count || 0),
    "Created": t.created_at || "",
    "Updated": t.updated_at || "",
    "Notes": t.notes || "",
  }));

  const contractRows = () => (state.contracts || []).map((c) => ({
    "Contract ID": c.contract_id || "",
    "Name": whoFor(c),
    "Vendor Name": c.vendor_name || "",
    "Client Name": c.client_name || "",
    "Signatory Name": c.signatory_name || "",
    "Brand": c.brand_name || "",
    "Amount": c.amount || "",
    "Type": c.contract_type || "",
    "License / ID": c.license_number || "",
    "Task ID": c.task_id || "",
    "Date Created": c.generated_at || "",
    "Has PDF": c.pdf_path ? "Yes" : "No",
    "Files": c.pdf_path ? "DOCX + PDF" : "DOCX",
  }));

  const wb = XLSX.utils.book_new();
  const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
  const today = new Date().toISOString().slice(0, 10);
  let filename, summary;

  switch (state.view) {
    case "vendors": {
      const rows = vendorRows(); add("Vendors", rows);
      filename = `vendors-${today}.xlsx`; summary = `${rows.length} vendors`; break;
    }
    case "clients": {
      const rows = clientRows(); add("Clients", rows);
      filename = `clients-${today}.xlsx`; summary = `${rows.length} clients`; break;
    }
    case "contracts": {
      const rows = contractRows(); add("Contracts", rows);
      filename = `contracts-${today}.xlsx`; summary = `${rows.length} contracts`; break;
    }
    case "tasks": {
      const rows = taskRows(); add("Tasks", rows);
      filename = `tasks-${today}.xlsx`; summary = `${rows.length} tasks`; break;
    }
    default: {
      // Operations / Templates / Settings → the full workbook.
      add("Contracts", contractRows());
      add("Tasks", taskRows());
      add("Vendors", vendorRows());
      add("Clients", clientRows());
      filename = `contract-suite-export-${today}.xlsx`;
      summary = "all data (Contracts, Tasks, Vendors, Clients)";
    }
  }

  XLSX.writeFile(wb, filename);
  showToast(`Exported ${summary}`);
}

function renderTemplatesView() {
  updateHeader("Templates", "DOCX template map, file health, and upload management");
  const uploadKey = state.templates.find((template) => !template.file_exists)?.key || defaultTemplateKey();
  const templateCards = state.templates.map((template) => {
    const activeFilename = template.active_filename || (template.file_exists ? template.filename : "");
    const isLegacyFile = activeFilename && activeFilename !== template.filename;
    return `
      <article class="template-item">
        <div class="template-title">
          <h3>${escapeHtml(template.display_name)}</h3>
          <div class="template-badges">
            ${template.file_exists ? pill("Found", "done") : pill("Missing", "hold")}
            ${template.is_default ? pill("Default") : ""}
            ${template.custom ? pill("Custom") : ""}
          </div>
        </div>
        <div class="template-details">
          <span><strong>Key</strong><code>${escapeHtml(template.key)}</code></span>
          <span><strong>Mapped file</strong>${escapeHtml(template.filename)}</span>
          <span><strong>Active file</strong>${escapeHtml(isLegacyFile ? activeFilename : (activeFilename || "No DOCX installed"))}</span>
          <span><strong>Size</strong>${escapeHtml(fileSize(template.size_kb))}</span>
          <span><strong>Updated</strong>${escapeHtml(dateTime(template.updated_at))}</span>
        </div>
        <div class="template-actions">
          <button class="secondary-button" data-action="set-default-template" data-key="${encodeAttr(template.key)}" type="button" ${isAdmin() && template.file_exists && !template.is_default ? "" : "disabled"}>Make Default</button>
          <button class="secondary-button" data-action="select-template-upload" data-key="${encodeAttr(template.key)}" type="button" ${isAdmin() ? "" : "disabled"}>Replace</button>
          <button class="danger-button" data-action="delete-template" data-key="${encodeAttr(template.key)}" type="button" ${isAdmin() ? "" : "disabled"}>Delete Slot</button>
        </div>
      </article>
    `;
  }).join("");

  els.viewRoot.innerHTML = `
    <section class="cs-kpi-strip" style="margin-bottom:22px;">
      <div class="cs-kpi is-tile">
        <div class="cs-kpi-label">Templates</div>
        <div class="cs-kpi-num">${state.templates.length.toLocaleString()}</div>
        <div class="cs-kpi-sub">slots</div>
      </div>
      <div class="cs-kpi">
        <div class="cs-kpi-label">Found</div>
        <div class="cs-kpi-num">${state.templates.filter((t) => t.file_exists).length.toLocaleString()}</div>
        <div class="cs-kpi-sub">files present</div>
      </div>
      <div class="cs-kpi">
        <div class="cs-kpi-label">Missing</div>
        <div class="cs-kpi-num" style="color:${state.templates.some((t) => !t.file_exists) ? "var(--cs-accent)" : "inherit"};">${state.templates.filter((t) => !t.file_exists).length.toLocaleString()}</div>
        <div class="cs-kpi-sub">need upload</div>
      </div>
      <div class="cs-kpi">
        <div class="cs-kpi-label">Default</div>
        <div style="font-size:18px;font-weight:600;margin-top:8px;line-height:1.2;">${escapeHtml(state.templates.find((t) => t.is_default)?.display_name || "—")}</div>
      </div>
    </section>

    <section style="display:grid;grid-template-columns:1fr 372px;gap:22px;align-items:start;">
      <div class="cs-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div class="cs-section-title">Template health</div>
          <button class="cs-btn-ghost" data-action="scan-templates" type="button">Scan</button>
        </div>
        <div class="template-list">${templateCards || `<p class="empty-note">No templates found.</p>`}</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:22px;">
        <form id="template-upload-form" class="side-panel">
          <h2>Add / Replace</h2>
          <label>Template Slot <select id="upload-key">${templateOptions(uploadKey)}</select></label>
          <label>DOCX File <input id="upload-file" type="file" accept=".docx" /></label>
          <button class="primary-button" type="submit" ${isAdmin() ? "" : "disabled"}>Upload Template</button>
          <p class="form-hint">${isAdmin() ? "Replaces the file inside an existing slot." : "Template changes require admin access."}</p>
        </form>

        <form id="template-create-form" class="side-panel">
          <h2>New Slot</h2>
          <label>Slot Name <input id="new-template-name" placeholder="Brand Contract" required /></label>
          <label>Key <input id="new-template-key" placeholder="brand_contract" /></label>
          <label>DOCX File <input id="new-template-file" type="file" accept=".docx" required /></label>
          <button class="primary-button" type="submit" ${isAdmin() ? "" : "disabled"}>Create Slot</button>
          <p class="form-hint">${isAdmin() ? "Creates a new dropdown option for contract generation." : "Creating slots requires admin access."}</p>
        </form>
      </div>
    </section>
  `;
}

function renderSettingsView() {
  updateHeader("Settings", "Profile, users, app settings, backups, and audit trail");
  const settingsRows = state.settings.map((item) => `<tr><td>${escapeHtml(item.key)}</td><td>${escapeHtml(item.value)}</td></tr>`).join("");
  const userRows = state.users.map((user) => `
    <tr>
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.full_name)}</td>
      <td>${escapeHtml(user.email)}</td>
      <td>${pill(user.role, user.role === "admin" ? "done" : "")}</td>
    </tr>
  `).join("");
  const backupRows = state.backups.map((backup) => `
    <tr><td>${escapeHtml(backup.filename)}</td><td>${escapeHtml(backup.size_kb)} KB</td><td>${escapeHtml(backup.created_at)}</td></tr>
  `).join("");
  const auditRows = state.audit.slice(0, 40).map((log) => `
    <tr>
      <td>${escapeHtml(log.created_at)}</td>
      <td>${escapeHtml(log.actor_username)}</td>
      <td>${escapeHtml(log.action)}</td>
      <td>${escapeHtml(log.entity_type)} ${escapeHtml(log.entity_id)}</td>
    </tr>
  `).join("");

  const theme = document.documentElement.getAttribute("data-theme") || "light";
  els.viewRoot.innerHTML = `
    <section style="display:grid;grid-template-columns:1fr 384px;gap:22px;align-items:start;">
      <div style="display:flex;flex-direction:column;gap:22px;">
        <form id="profile-form" class="side-panel">
          <h2>Profile</h2>
          <label>Full Name <input id="profile-name" value="${encodeAttr(state.user?.full_name || "")}" /></label>
          <label>Email <input id="profile-email" type="email" value="${encodeAttr(state.user?.email || "")}" /></label>
          <label>Profile Color <input id="profile-color" type="color" value="${encodeAttr(state.user?.profile_color || "#14140f")}" /></label>
          <label>New Password <input id="profile-password" type="password" placeholder="Leave blank" /></label>
          <button class="primary-button" type="submit">Save Profile</button>
        </form>

        <div class="cs-card">
          <div class="cs-section-title" style="margin-bottom:14px;">Users</div>
          ${isAdmin() ? simpleTable(["Username", "Name", "Email", "Role"], userRows) : `<p class="empty-note">User management requires admin access.</p>`}
        </div>

        ${isAdmin() ? renderInvitesSection() : ""}
      </div>

      <div style="display:flex;flex-direction:column;gap:22px;">
        <div class="cs-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
            <div class="cs-section-title">App settings</div>
            <button class="cs-btn-ghost" data-action="create-backup" type="button" ${isAdmin() ? "" : "disabled"}>Create backup</button>
          </div>
          ${simpleTable(["Key", "Value"], settingsRows)}
        </div>

        <div class="cs-card">
          <div class="cs-section-title" style="margin-bottom:14px;">Backups</div>
          ${isAdmin() ? simpleTable(["Filename", "Size", "Created"], backupRows) : `<p class="empty-note">Backup management requires admin access.</p>`}
        </div>

        <div class="cs-card">
          <div class="cs-section-title" style="margin-bottom:14px;">Appearance</div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <span style="font-size:13.5px;color:var(--cs-ink2);">Theme</span>
            <div class="cs-seg">
              <button type="button" class="${theme === "light" ? "active" : ""}" data-action="set-theme" data-theme="light">Light</button>
              <button type="button" class="${theme === "dark" ? "active" : ""}" data-action="set-theme" data-theme="dark">Dark</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div class="cs-card" style="margin-top:22px;">
      <div class="cs-section-title" style="margin-bottom:14px;">Audit log</div>
      ${isAdmin() ? simpleTable(["Time", "Actor", "Action", "Entity"], auditRows) : `<p class="empty-note">Audit logs require admin access.</p>`}
    </div>
  `;
}

/**
 * Per-user invite admin section (Settings → Invites).
 * Admin types name + email + role, clicks Send → backend creates a token
 * and returns the share link. Admin copies the link and sends it manually
 * (Resend integration will auto-email once configured).
 */
function renderInvitesSection() {
  const now = new Date();
  const inviteRows = (state.invites || []).map((inv) => {
    const expires = inv.expires_at ? new Date(inv.expires_at) : null;
    const expired = expires && expires < now;
    const claimed = !!inv.claimed_at;
    const status = claimed
      ? pill("claimed", "done")
      : expired
        ? pill("expired", "pending")
        : pill("pending", "");
    // Pretty countdown ("12m" / "expired") so admins can tell at a glance
    // whether a code is still useful.
    let countdown = "—";
    if (expires) {
      if (expired) countdown = "expired";
      else {
        const mins = Math.max(0, Math.round((expires - now) / 60000));
        countdown = `${mins}m left`;
      }
    }
    const codeDisplay = claimed || expired
      ? `<code style="opacity:0.5;text-decoration:line-through">${escapeHtml(inv.token)}</code>`
      : `<code style="font-weight:700;letter-spacing:0.15em;font-size:14px;background:#e8f5ed;padding:3px 8px;border-radius:4px;color:#166534">${escapeHtml(inv.token)}</code>`;
    const actions = claimed ? "" : `
      <button class="ghost-button" type="button" data-action="copy-invite" data-link="${encodeAttr(inv.token)}" title="Copy the code">Copy</button>
      <button class="ghost-button" type="button" data-action="revoke-invite" data-id="${encodeAttr(inv.id)}" title="Revoke">✕</button>
    `;
    return `
      <tr>
        <td>${escapeHtml(inv.full_name || inv.email)}</td>
        <td>${escapeHtml(inv.email)}</td>
        <td>${escapeHtml(inv.role)}</td>
        <td>${codeDisplay}</td>
        <td>${status}</td>
        <td>${escapeHtml(countdown)}</td>
        <td>${actions}</td>
      </tr>
    `;
  }).join("");

  return `
    <section class="glass-panel">
      <div class="panel-header"><h2>Invites</h2></div>
      <form id="invite-form" style="display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin-bottom:14px;">
        <label style="flex:1;min-width:160px;">
          Name
          <input id="invite-name" placeholder="Jane Smith" />
        </label>
        <label style="flex:1;min-width:200px;">
          Email
          <input id="invite-email" type="email" placeholder="jane@aqcreativity.com" required />
        </label>
        <label>
          Role
          <select id="invite-role">
            <option value="member" selected>Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button class="primary-button" type="submit">Send invite</button>
      </form>
      <p style="font-size:12px;color:var(--text-muted);margin:0 0 10px;">
        Codes are 6 characters, expire in 30 minutes, and can be used once. Share by WhatsApp / phone / in person — no email is sent.
      </p>
      ${simpleTable(
        ["Name", "Email", "Role", "Code", "Status", "Expires", ""],
        inviteRows || `<tr><td colspan="7" class="empty-note">No invites yet.</td></tr>`,
      )}
    </section>
  `;
}

function buildInviteLink(token) {
  if (typeof window === "undefined") return "";
  // Invite links land on the dedicated /invite page (a small static signup
  // form that ONLY appears when a valid token is in the URL). The contract
  // maker (/contracts/) itself never shows signup — login only.
  const origin = window.location.origin;
  return `${origin}/invite?token=${encodeURIComponent(token)}`;
}

async function login(signup = false) {
  // CRITICAL: clear ANY existing token before logging in. A stale token in
  // localStorage (e.g. from a deleted user, or from a different deploy)
  // gets sent as a Bearer header on the login request itself and triggers
  // the backend's 401 auto-logout path, looking like "session expired" the
  // moment you try to log in.
  clearStoredToken();
  state.token = "";
  state.user = null;
  // Also pause the auto-logout trigger so a stray 401 from refreshAll
  // immediately after sign-in doesn't yank the user back to the login
  // screen before they can see anything.
  state._suppressAutoLogout = true;

  const online = await checkHealth();
  if (!online) throw new Error("Backend is not reachable");

  let username, password, body, remember;
  if (signup) {
    username = safeText(document.querySelector("#signup-username")?.value
            || document.querySelector("#username")?.value || "");
    password = document.querySelector("#signup-password")?.value
            || document.querySelector("#password")?.value;
    const fullName = safeText(document.querySelector("#signup-full-name")?.value || "") || username;
    const email = safeText(document.querySelector("#signup-email")?.value || "");
    const inviteCode = safeText(document.querySelector("#signup-invite-code")?.value || "");
    // Per-user invite token from ?invite=... in the URL. Takes priority
    // over the shared invite_code when present.
    const inviteToken = state.pendingInviteFromUrl?.token || "";
    if (!username) throw new Error("Username is required.");
    if (!password) throw new Error("Password is required.");
    if (!email) throw new Error("Email is required to create an account.");
    body = {
      username,
      password,
      email,
      full_name: fullName,
      invite_code: inviteCode || null,
      invite_token: inviteToken || null,
    };
    // After signup we want the user signed in. Default = remember (matches the
    // sign-in card's default checkbox state).
    remember = true;
  } else {
    username = safeText(document.querySelector("#username").value);
    password = document.querySelector("#password").value;
    body = { username, password };
    // Remember-me is opt-out: checked by default. If unchecked, we keep the
    // token in sessionStorage only — closing the tab forgets the user.
    remember = !!document.querySelector("#remember-me")?.checked;
  }

  const endpoint = signup ? "/api/auth/signup" : "/api/auth/login";
  const data = await api(endpoint, { method: "POST", body: JSON.stringify(body) });

  state.token = data.access_token;
  state.user = data.user;
  storeToken(state.token, remember);
  setSignedIn(true);
  renderUser();
  // Catch ANY failure in the bulk refresh after sign-in so a single 401 from
  // a non-essential admin-only endpoint doesn't tank the fresh session.
  // Individual views will re-fetch what they need on demand.
  try {
    await refreshAll();
  } catch (refreshErr) {
    console.warn("Post-login refresh failed (non-fatal):", refreshErr);
  }
  state._suppressAutoLogout = false;
  renderCurrentView();
  showToast(signup ? "Account created" : "Logged in");
}

async function loadMe() {
  await checkHealth();

  if (!state.token) {
    setSignedIn(false);
    renderUser();
    return;
  }

  try {
    state.user = await api("/api/auth/me", { body: undefined });
    setSignedIn(true);
    renderUser();
    try {
      await refreshAll();
    } catch (refreshErr) {
      console.warn("Initial refresh failed (non-fatal):", refreshErr);
    }
    setView(state.view);
  } catch (error) {
    // /me itself failed — the token is genuinely bad. Only THIS path bounces
    // back to the login screen, and only on page-load bootstrap. Once the
    // user is in the app via a successful login, no automatic logout fires.
    clearStoredToken();
    state.token = "";
    state.user = null;
    setSignedIn(false);
    renderUser();
    showToast(error.message, "error");
  }
}

function getFormValue(id) {
  return document.querySelector(id)?.value?.trim() || "";
}

// ─── Vendor license autocomplete ────────────────────────────────────
//
// Replaces the native <datalist> on the Add Subtask form. Reasoning:
//   - Native datalists filter by exact PREFIX on the option's `value`
//     attr. That meant typing the vendor's name didn't match anything
//     (the value is the license_number), and even typing the start of
//     a license got slow / janky in Chrome with many vendors.
//   - Browsers don't agree on how to render the value vs. label, so
//     the dropdown looked different on every machine.
//
// Now: we render our own dropdown below the input. On every keystroke
// we score `state.vendors` by case-insensitive substring match on the
// license number, vendor name, and id_number; the top 20 hits are
// drawn as clickable rows. Picking a row writes the license_number
// into the input and dispatches an `input` event so the existing
// syncSubtaskVendorFields → IBAN/bank-preview chain runs unchanged.
const SUB_LICENSE_MAX_SUGGESTIONS = 20;
let subLicenseHoverIndex = -1;

function vendorMatchesQuery(vendor, q) {
  if (!q) return true;
  return [vendor.license_number, vendor.name, vendor.id_number]
    .some((v) => String(v || "").toLowerCase().includes(q));
}

function getSubLicenseDom() {
  return {
    input: document.getElementById("sub-license"),
    box: document.getElementById("sub-license-suggestions"),
  };
}

function renderSubLicenseSuggestions(query) {
  const { box } = getSubLicenseDom();
  if (!box) return;
  const q = (query || "").trim().toLowerCase();
  // Don't drop the list when the user clears the field — show the top
  // 20 alphabetical so they can still scroll. Mirrors how native
  // datalists felt when they were working.
  const matches = state.vendors.filter((v) => vendorMatchesQuery(v, q))
    .slice(0, SUB_LICENSE_MAX_SUGGESTIONS);

  if (matches.length === 0) {
    box.innerHTML = `<div class="autocomplete-empty">No vendors match "${escapeHtml(query)}"</div>`;
    box.hidden = false;
    subLicenseHoverIndex = -1;
    return;
  }

  // Highlight whichever row matches subLicenseHoverIndex so arrow
  // keys can move through the list.
  box.innerHTML = matches.map((v, i) => `
    <button type="button" class="autocomplete-row ${i === subLicenseHoverIndex ? "is-active" : ""}"
            data-license="${encodeAttr(v.license_number || "")}"
            data-vendor-id="${encodeAttr(v.id)}">
      <span class="autocomplete-primary">${escapeHtml(v.name || "(no name)")}</span>
      <span class="autocomplete-secondary">${escapeHtml(v.license_number || v.id_number || "—")}</span>
    </button>
  `).join("");
  box.hidden = false;
}

function hideSubLicenseSuggestions() {
  const { box } = getSubLicenseDom();
  if (box) box.hidden = true;
  subLicenseHoverIndex = -1;
}

/** Set the input to a picked vendor's license and let the existing
 *  syncSubtaskVendorFields flow handle bank / IBAN side-effects. */
function pickSubLicenseVendor(license) {
  const { input } = getSubLicenseDom();
  if (!input) return;
  input.value = license || "";
  // Dispatch an "input" event so the global listener picks this up and
  // runs the IBAN/bank preview update. Otherwise the user would see a
  // selected name with stale bank rows.
  input.dispatchEvent(new Event("input", { bubbles: true }));
  hideSubLicenseSuggestions();
}

function syncSubtaskVendorFields() {
  const licenseInput = document.querySelector("#sub-license");
  const vendorInput = document.querySelector("#sub-vendor");
  const ibanSelect = document.querySelector("#sub-iban");
  const preview = document.querySelector("#sub-bank-preview");
  if (!licenseInput || !vendorInput || !ibanSelect || !preview) return;

  const vendor = findVendorByLicense(licenseInput.value);
  if (!vendor) {
    vendorInput.value = "";
    ibanSelect.innerHTML = `<option value="">No matching vendor</option>`;
    ibanSelect.disabled = true;
    preview.innerHTML = `<strong>Bank information</strong><span>No vendor found for this license.</span>`;
    return;
  }

  vendorInput.value = vendor.name || "";
  const banks = vendor.bank_accounts || [];
  ibanSelect.disabled = !banks.length;
  ibanSelect.innerHTML = banks.length
    ? banks.map((bank) => `<option value="${encodeAttr(bank.iban)}">${escapeHtml(bank.iban)} / ${escapeHtml(bank.bank_name)}</option>`).join("")
    : `<option value="">No IBAN saved for this vendor</option>`;
  syncSubtaskBankPreview(vendor);
}

function syncSubtaskBankPreview(vendor = null) {
  const licenseInput = document.querySelector("#sub-license");
  const ibanSelect = document.querySelector("#sub-iban");
  const preview = document.querySelector("#sub-bank-preview");
  if (!licenseInput || !ibanSelect || !preview) return;
  const selectedVendor = vendor || findVendorByLicense(licenseInput.value);
  const bank = findBank(selectedVendor, ibanSelect.value);
  if (!bank) {
    preview.innerHTML = `<strong>Bank information</strong><span>No bank account selected.</span>`;
    return;
  }
  preview.innerHTML = `
    <strong>${escapeHtml(bank.bank_name)}</strong>
    <span>Account: ${escapeHtml(bank.account_name || "")}</span>
    <span>IBAN: ${escapeHtml(bank.iban || "")}</span>
    <span>Account No: ${escapeHtml(bank.account_number || "")}</span>
    <span>SWIFT: ${escapeHtml(bank.swift_code || "")}</span>
  `;
}

function selectedPlatformKeys() {
  return [...document.querySelectorAll(".platform-checkbox:checked")].map((input) => input.value);
}

function normalizeHandle(value) {
  const cleaned = String(value || "").trim().replace(/^@+/, "");
  return cleaned ? `@${cleaned}` : "";
}

function normalizeIban(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function renderPlatformHandleFields() {
  const container = document.querySelector("#platform-handles");
  if (!container) return;

  const keys = selectedPlatformKeys();
  if (!keys.length) {
    container.innerHTML = `<p class="form-hint">Select a platform to add its handle.</p>`;
    syncPlatformPayload();
    return;
  }

  const existing = {};
  document.querySelectorAll(".platform-handle").forEach((input) => {
    existing[input.dataset.platform] = input.value;
  });

  container.innerHTML = keys.map((key) => {
    const label = platformLabel(key);
    return `
      <label>
        ${label}
        <div class="handle-input">
          <span>@</span>
          <input class="platform-handle" data-platform="${key}" placeholder="name" value="${encodeAttr(String(existing[key] || "").replace(/^@+/, ""))}" />
        </div>
      </label>
    `;
  }).join("");
  syncPlatformPayload();
}

function syncPlatformPayload() {
  const platformsInput = document.querySelector("#sub-platforms");
  const channelInput = document.querySelector("#sub-channel");
  if (!platformsInput || !channelInput) return;

  const keys = selectedPlatformKeys();
  const handles = [...document.querySelectorAll(".platform-handle")];
  const handleByKey = Object.fromEntries(handles.map((input) => [input.dataset.platform, normalizeHandle(input.value)]));

  platformsInput.value = keys.join(",");
  if (keys.length === 1) {
    channelInput.value = handleByKey[keys[0]] || "";
    return;
  }

  channelInput.value = keys
    .map((key) => {
      const handle = handleByKey[key];
      return handle ? `${platformLabel(key)}: ${handle}` : "";
    })
    .filter(Boolean)
    .join(" ");
}

/**
 * Build the user-facing download filename:  "vendor - brand - 08-Jun-2026.pdf"
 *
 * The backend now sends this exact format via Content-Disposition (see
 * _pretty_download_name in app/routers/contracts.py). We keep a matching
 * client-side builder so the *fallback* name (used when the browser
 * couldn't parse Content-Disposition) stays consistent. (Format change
 * requested 2026-06-09 by Siraj — contract_id is intentionally NOT in
 * the filename anymore; it's printed inside the contract document via
 * the template's {{ id }} field.)
 */
const _MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function prettyContractName(c, ext) {
  const safe = (s) => String(s ?? "").replace(/[\\/*?:"<>|]/g, "").trim();
  // Skip empty parts instead of falling back to contract_id — client
  // contracts have vendor_name="" by design, and substituting contract_id
  // there was reintroducing "CTR…" into the filename (reported 2026-06-10).
  const vendor = safe(c?.vendor_name || c?.client_name || c?.signatory_name || "");
  const brand  = safe(c?.brand_name);
  let date = "";
  const m = String(c?.generated_at || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const mo = parseInt(m[2], 10);
    if (mo >= 1 && mo <= 12) date = `${m[3]}-${_MONTH_ABBR[mo - 1]}-${m[1]}`;
  }
  if (!date) {
    const d = new Date();
    date = `${String(d.getDate()).padStart(2, "0")}-${_MONTH_ABBR[d.getMonth()]}-${d.getFullYear()}`;
  }
  const parts = [vendor, brand, date].filter(Boolean);
  // Last-resort safety net so the file always has SOME name.
  if (parts.length === 0) parts.push(safe(c?.contract_id) || "contract");
  return `${parts.join(" - ")}.${ext}`;
}

async function downloadFile(path, fallbackName) {
  // Use a native browser download via hidden iframe rather than fetching
  // the bytes into JS and triggering a JS-mediated download. Why: Chrome on
  // Windows strips non-ASCII characters (Arabic, CJK, …) from every
  // JS-supplied filename — blob URL, data URL, even showSaveFilePicker's
  // suggestedName. Reported and confirmed via debug snippet on 2026-06-10.
  //
  // The native flow uses the server's Content-Disposition header (which
  // carries filename*=UTF-8'' for proper UTF-8 round-trip) and saves the
  // file directly without any JS sanitization layer.
  //
  // Auth: an iframe request can't carry an Authorization header, so we
  // append `?token=…` to the URL. The backend's `get_user_for_download`
  // dependency accepts either header or query param. JWT expiry (~8h)
  // limits the risk of token leakage via browser history / server logs.
  const token = (typeof aqToken === "function" && aqToken())
              || localStorage.getItem("aq_token")
              || "";
  if (!token) {
    showToast("Not signed in.", "error");
    return;
  }
  const url = `${API_BASE}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;

  setBusy(true);
  try {
    // Pre-check that the file actually exists (and trigger /regenerate if
    // not) before opening the iframe — otherwise the 404 lands silently
    // inside the iframe with no user feedback.
    let response = await fetch(`${API_BASE}${path}`, {
      headers: authHeaders(false),
      method: "HEAD",
    });
    if (response.status === 404) {
      const m = path.match(/\/contracts\/download\/(pdf|docx)\/([^/?#]+)/);
      if (m) {
        const contractId = decodeURIComponent(m[2]);
        showToast(`File missing — regenerating ${contractId}…`, "warn");
        try {
          await api(`/api/contracts/${contractId}/regenerate`, { method: "POST" });
        } catch (regenErr) {
          throw new Error(`File missing and regenerate failed: ${regenErr.message || regenErr}`);
        }
      }
    } else if (!response.ok && response.status !== 405 /* HEAD not allowed */) {
      const message = await response.text();
      throw new Error(message || `Download failed with ${response.status}`);
    }

    // Trigger the native download. The iframe approach keeps the page
    // visible (vs setting window.location, which can cause navigation
    // flicker on some browsers). Most browsers fire `load` even for
    // 200 + Content-Disposition: attachment; the iframe sits idle and
    // we clean it up later.
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = url;
    document.body.appendChild(iframe);
    setTimeout(() => { try { iframe.remove(); } catch (_) {} }, 60_000);
    // Mark the suggested name for the user (toast / log only — no longer
    // used to set link.download). Browser uses the server's CD header.
    if (fallbackName) console.debug("Download suggested filename:", fallbackName);
    return;
  } finally {
    setBusy(false);
  }

  // (Old blob-fetching / JS-mediated download path was removed 2026-06-10
  // — Chrome on Windows strips Arabic from every JS-supplied filename,
  // regardless of URL scheme or showSaveFilePicker. The iframe path above
  // uses the browser's native download flow, which respects the server's
  // Content-Disposition: filename*=UTF-8'' header correctly.)
  /* eslint-disable no-unreachable */
  // The block below is dead code, intentionally kept as a fallback example
  // in case we need to roll back. Wrapped in `if (false)` so static analyzers
  // and bundlers eliminate it without breaking syntax.
  if (false) {
    let response = await fetch(`${API_BASE}${path}`, {
      headers: authHeaders(false),
    });
    if (response.status === 404) {
      const m = path.match(/\/contracts\/download\/(pdf|docx)\/([^/?#]+)/);
      if (m) {
        const contractId = decodeURIComponent(m[2]);
        showToast(`File missing — regenerating ${contractId}…`, "warn");
        try {
          await api(`/api/contracts/${contractId}/regenerate`, { method: "POST" });
          response = await fetch(`${API_BASE}${path}`, { headers: authHeaders(false) });
        } catch (regenErr) {
          throw new Error(`File missing and regenerate failed: ${regenErr.message || regenErr}`);
        }
      }
    }

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `Download failed with ${response.status}`);
    }

    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    // Prefer RFC 5987's filename*=UTF-8''<percent-encoded> when present —
    // that's where non-ASCII names (Arabic vendor names, etc.) actually
    // round-trip without being mangled by the latin-1 header pipeline.
    // Fall back to plain filename= for old browsers / old servers.
    let filename = fallbackName;
    const utf8Match = disposition.match(/filename\*\s*=\s*UTF-8''([^;\n]+)/i);
    if (utf8Match) {
      try { filename = decodeURIComponent(utf8Match[1]); }
      catch (_) { /* malformed encoding — keep the fallback */ }
    } else {
      const asciiMatch = disposition.match(/filename\s*=\s*"?([^";\n]+)"?/i);
      if (asciiMatch) filename = asciiMatch[1];
    }

    // Chrome-on-Windows bug (2026-06-10): non-ASCII chars in `link.download`
    // are stripped when href is a blob: URL OR a data: URL of type
    // application/pdf. The same code works for data:text/plain (proven
    // by an earlier test). So the stripping is keyed off MIME, not URL
    // type. Two-tier fix:
    //
    //   1. Prefer File System Access API (showSaveFilePicker) — Chrome
    //      86+ on HTTPS. Bypasses Chrome's download-filename sanitization
    //      entirely; shows a native Save dialog with the suggested name
    //      verbatim. User confirms with one click.
    //   2. Fallback: re-blob the bytes as application/octet-stream (no
    //      PDF-specific download mangling) and trigger via data URL.
    //   3. Last resort: blob URL (Arabic will get stripped, but the
    //      download still works).
    if (typeof window.showSaveFilePicker === "function") {
      try {
        const isPdf = filename.toLowerCase().endsWith(".pdf");
        const isDocx = filename.toLowerCase().endsWith(".docx");
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: isPdf ? [{
            description: "PDF document",
            accept: { "application/pdf": [".pdf"] },
          }] : isDocx ? [{
            description: "Word document",
            accept: { "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] },
          }] : [],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err) {
        // User dismissed the picker — treat as cancel.
        if (err && err.name === "AbortError") return;
        // SecurityError = called without user gesture; fall through to
        // the data-URL path so the user still gets the file.
        console.warn("showSaveFilePicker failed, falling back:", err);
      }
    }

    // Fallback path: re-blob as octet-stream so Chrome doesn't apply
    // PDF-specific filename sanitization to the data URL download.
    const LARGE_FILE_BYTES = 30 * 1024 * 1024;
    if (blob.size <= LARGE_FILE_BYTES) {
      const buf = await blob.arrayBuffer();
      const genericBlob = new Blob([buf], { type: "application/octet-stream" });
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload  = () => resolve(fr.result);
        fr.onerror = () => reject(fr.error || new Error("FileReader failed"));
        fr.readAsDataURL(genericBlob);
      });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }
  }
}

async function saveTask(event) {
  event.preventDefault();
  const taskId = getFormValue("#task-id");
  const body = {
    brand: getFormValue("#task-brand"),
    duration: getFormValue("#task-duration"),
    contract_type: getFormValue("#task-type"),
    status: getFormValue("#task-status"),
    end_date: getFormValue("#task-end-date"),
    notes: getFormValue("#task-notes"),
  };

  if (taskId) {
    const updated = await api(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    state.tasks = state.tasks.map((task) => task.id === updated.id ? updated : task);
    showToast("Task saved");
  } else {
    const created = await api("/api/tasks/", {
      method: "POST",
      body: JSON.stringify(body),
    });
    state.selectedTaskId = created.id;
    localStorage.setItem("aq_selected_task", created.id);
    state.tasks = [created, ...state.tasks];
    showToast("Task created");
  }

  renderTasksView();
}

async function addSubtask(event) {
  event.preventDefault();
  const task = selectedTask();
  if (!task) throw new Error("Select a task first");
  const vendor = findVendorByLicense(getFormValue("#sub-license"));
  if (!vendor) throw new Error("Choose a valid vendor license first");
  const bank = findBank(vendor, getFormValue("#sub-iban"));
  if (!bank) throw new Error("Choose an IBAN for this vendor");
  syncPlatformPayload();
  if (!getFormValue("#sub-platforms")) throw new Error("Choose at least one platform");
  if (!getFormValue("#sub-channel")) throw new Error("Enter a handle for at least one selected platform");

  await api("/api/subtasks/", {
    method: "POST",
    body: JSON.stringify({
      task_id: task.id,
      vendor: vendor.name || "",
      license_number: vendor.license_number || "",
      iban: bank.iban || "",
      channel: getFormValue("#sub-channel"),
      platforms: getFormValue("#sub-platforms"),
      ad_type: getFormValue("#sub-ad-type"),
      ad_type_custom: getFormValue("#sub-ad-type-custom") || "",
      qty: getFormValue("#sub-qty") || "1",
      details: getFormValue("#sub-details"),
      price: getFormValue("#sub-price") || "0",
    }),
  });

  await loadTasks();
  await renderTasksView();
  showToast("Subtask added");
}

/**
 * Generate contracts for the given subtask IDs (or all subtasks under the
 * task when subtaskIds is null). After success, reloads contracts, switches
 * to the Contracts view, and shows a toast.
 */
/**
 * Update the Generate dropdown's "Selected only" button in-place so its
 * disabled state + count badge reflect state.selectedSubtaskIds without
 * needing a full renderTasksView() (which would re-mount the checkboxes
 * mid-click and steal focus).
 *
 * Also syncs the header "select all" checkbox so it shows the right state
 * when individual rows are ticked up to fully-selected.
 */
function refreshGenerateSelectedHandle() {
  const count = state.selectedSubtaskIds?.size || 0;

  const btn = document.querySelector('[data-action="generate-selected"]');
  if (btn) {
    if (count === 0) btn.setAttribute('disabled', '');
    else btn.removeAttribute('disabled');
    const badge = btn.querySelector('.menu-badge');
    if (badge) badge.textContent = String(count);
  }

  const headerAll = document.getElementById('subtask-pick-all');
  if (headerAll) {
    const total = state.subtasks?.length || 0;
    headerAll.checked = total > 0 && count === total;
    headerAll.indeterminate = count > 0 && count < total;
  }
}

async function generateForSubtasks(taskId, subtaskIds, successMessage) {
  const body = { task_id: taskId };
  if (subtaskIds && subtaskIds.length) body.subtask_ids = subtaskIds;

  // Auto-retry: Render's free-tier worker cold-starts on the first request
  // after idle, and LibreOffice on Linux is itself slow + intermittent, so
  // we give up to 3 attempts with backoff. Per the HANDOFF gotcha, the
  // strategy is to extend the *retry surface* (not the per-attempt timeout)
  // because past attempts at extending the server timeout blew browser
  // limits. Worst case total wait added by retries: 3s + 6s = 9s.
  // (Bumped from 2 to 3 attempts on 2026-05-21.)
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAYS_MS = [3000, 6000];  // delay before attempt 2 and 3
  let generated;
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      generated = await api("/api/contracts/generate", {
        method: "POST",
        body: JSON.stringify(body),
      });
      break;
    } catch (err) {
      lastError = err;
      const msg = String(err?.message || err);
      const isTransient = /failed to fetch|networkerror|timeout|502|503|504/i.test(msg);
      if (attempt === MAX_ATTEMPTS || !isTransient) throw err;
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? 6000;
      showToast(
        `Backend is warming up — retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1} of ${MAX_ATTEMPTS})…`,
        "warn",
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  if (!generated) throw lastError || new Error("Generation failed");

  await loadContracts();
  state.selectedSubtaskIds = new Set();        // wipe the checkboxes
  const pdfCount = generated.filter((item) => item.pdf_path).length;
  const failed = generated.filter((item) => !item.pdf_path);
  const pdfDisabled = failed.length > 0 && failed.every((item) => /disabled/i.test(item.pdf_error || ""));
  // Switch to the Contracts view so the user sees what they just made.
  setView("contracts");
  renderContractsView();
  if (failed.length === 0) {
    showToast(`${successMessage} (${pdfCount} PDFs)`);
  } else if (pdfDisabled) {
    showToast(`${successMessage} — Word document${generated.length === 1 ? "" : "s"} ready.`);
  } else {
    showToast(`${successMessage} ${failed.length} PDF conversion${failed.length === 1 ? "" : "s"} failed — DOCX still saved. Click Regenerate on the contract row to retry.`, "warn");
  }
}

/** Re-run generation for one existing contract (used when a download 404s). */
async function regenerateContract(contractId) {
  const result = await api(`/api/contracts/${contractId}/regenerate`, { method: "POST" });
  await loadContracts();
  renderContractsView();
  showToast(result.pdf_path ? `Regenerated ${contractId}` : `${contractId} regenerated (DOCX only — PDF failed)`, result.pdf_path ? "success" : "warn");
  return result;
}

/**
 * Replace-contract flow (added 2026-06-09):
 *   1. Open a hidden <input type="file" accept=".pdf,.docx"> on demand.
 *   2. User picks ONE file. We detect extension → choose endpoint.
 *   3. POST as multipart/form-data to /api/contracts/{id}/replace/{kind}.
 *   4. Refresh the archive so the "DOCX + PDF" badge updates.
 *
 * The backend (app/routers/contracts.py :: replace_contract_file) validates
 * size + magic bytes and writes to Supabase Storage (upsert), so the very
 * next download returns the user's edited file.
 */
async function openReplaceFilePicker(contractId) {
  // Lazy-build a single hidden input we can reuse across clicks.
  let input = document.getElementById("__replace-contract-input");
  if (!input) {
    input = document.createElement("input");
    input.id = "__replace-contract-input";
    input.type = "file";
    input.accept = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    input.style.display = "none";
    document.body.appendChild(input);
  }
  // Reset previous selection so the same file can be picked again later.
  input.value = "";

  // One-shot handler — replaced on every open so handlers don't pile up.
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    const kind = name.endsWith(".pdf") ? "pdf"
               : name.endsWith(".docx") ? "docx"
               : null;
    if (!kind) {
      showToast("Pick a .pdf or .docx file", "error");
      return;
    }
    if (file.size === 0) {
      showToast("That file is empty", "error");
      return;
    }
    // Confirm to prevent fat-finger replacements on the wrong row.
    if (!confirm(`Replace the ${kind.toUpperCase()} for ${contractId} with "${file.name}"?\n\nThis will overwrite the current file. The old one cannot be restored.`)) {
      return;
    }

    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);

      // We can't use api() here because it stringifies JSON bodies; build
      // the fetch by hand with the JWT header and multipart body.
      const resp = await fetch(
        `${API_BASE}/api/contracts/${encodeURIComponent(contractId)}/replace/${kind}`,
        {
          method: "POST",
          headers: authHeaders(false),  // no Content-Type — browser sets multipart boundary
          body: formData,
        },
      );

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(body || `Replace failed (${resp.status})`);
      }
      const result = await resp.json().catch(() => ({}));
      showToast(`${kind.toUpperCase()} replaced (${Math.round((result.size || file.size) / 1024)} KB)`, "success");
      await loadContracts();
      renderContractsView();
    } catch (err) {
      showToast(`Replace failed: ${err.message || err}`, "error");
    } finally {
      setBusy(false);
    }
  };

  input.click();
}

function showClientContractModal() {
  const task = selectedTask();
  if (!task) { showToast("Select a task first", "error"); return; }
  if (!state.clients.length) { showToast("No clients found. Add a client first from the Vendors & Clients view.", "error"); return; }

  // Pre-select the client from the inline client mode form if one was chosen there
  const preSelectedClient = document.querySelector("#cc-client-select")?.value || "";

  const clientOptions = state.clients.map((c) =>
    `<option value="${encodeAttr(c.id)}" ${String(c.id) === preSelectedClient ? "selected" : ""}>${escapeHtml(c.company_name || c.name || c.id)}</option>`
  ).join("");

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-card" style="max-width:480px">
      <h2>Generate Client Contract</h2>
      <p style="color:#888;font-size:0.9em;margin-bottom:1rem">Task: ${escapeHtml(task.brand)} — ${state.subtasks.length} influencer(s)${state.subtasks.length === 0 ? " (table will be empty)" : ""}</p>
      <label>Client
        <select id="cc-client">${clientOptions}</select>
      </label>
      <label>Brand
        <select id="cc-brand"><option value="">Loading brands...</option></select>
      </label>
      <label>Total Amount
        <input id="cc-amount" type="text" value="${encodeAttr(task.amount || "0")}" />
      </label>
      <div style="display:flex;gap:0.5rem;margin-top:1rem">
        <button class="primary-button" id="cc-submit" style="flex:1">Generate</button>
        <button class="secondary-button" id="cc-cancel" style="flex:1">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Load brands for the first selected client
  const clientSelect = overlay.querySelector("#cc-client");
  const brandSelect = overlay.querySelector("#cc-brand");

  async function refreshBrands() {
    const clientId = clientSelect.value;
    if (!clientId) { brandSelect.innerHTML = '<option value="">-- no client --</option>'; return; }
    try {
      const brands = await api(`/api/brands?client_id=${encodeURIComponent(clientId)}`, { body: undefined });
      state.clientBrands = brands;
      if (brands.length) {
        brandSelect.innerHTML = brands.map((b) =>
          `<option value="${encodeAttr(b.id)}">${escapeHtml(b.brand_name)}</option>`
        ).join("");
      } else {
        brandSelect.innerHTML = '<option value="">No brands — will use client name</option>';
      }
    } catch {
      brandSelect.innerHTML = '<option value="">Error loading brands</option>';
    }
  }
  refreshBrands();
  clientSelect.addEventListener("change", refreshBrands);

  overlay.querySelector("#cc-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector("#cc-submit").addEventListener("click", async () => {
    const clientId = clientSelect.value;
    const brandId = brandSelect.value || null;
    const amount = overlay.querySelector("#cc-amount").value || "0";
    if (!clientId) { showToast("Select a client", "error"); return; }

    overlay.querySelector("#cc-submit").disabled = true;
    overlay.querySelector("#cc-submit").textContent = "Generating...";

    try {
      const result = await api("/api/contracts/generate-client", {
        method: "POST",
        body: JSON.stringify({
          task_id: task.id,
          client_id: clientId,
          brand_id: brandId,
          total_amount: amount,
        }),
      });
      await loadContracts();
      overlay.remove();
      setView("contracts");
      renderContractsView();
      const msg = result.pdf_path
        ? "Client contract generated (DOCX + PDF)"
        : `Client contract generated (DOCX only — ${result.pdf_error || "PDF failed"})`;
      showToast(msg, result.pdf_path ? "success" : "warn");
    } catch (err) {
      overlay.querySelector("#cc-submit").disabled = false;
      overlay.querySelector("#cc-submit").textContent = "Generate";
      showToast(`Generation failed: ${err.message || err}`, "error");
    }
  });
}

async function createClient(event) {
  event.preventDefault();
  const body = {
    company_name: getFormValue("#new-client-company"),
    cr_number: getFormValue("#new-client-cr"),
    vat_number: getFormValue("#new-client-vat"),
    signatory_name: getFormValue("#new-client-signatory"),
    phone: getFormValue("#new-client-phone"),
    email: getFormValue("#new-client-email"),
    company_email: getFormValue("#new-client-company-email"),
    street: getFormValue("#new-client-street"),
    city: getFormValue("#new-client-city"),
    postcode: getFormValue("#new-client-postcode"),
    country: getFormValue("#new-client-country"),
    national_address: getFormValue("#new-client-national"),
  };
  const created = await api("/api/vendors/manual/clients", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await loadClients();
  state.selectedClientId = String(created.id);
  localStorage.setItem("aq_selected_client", state.selectedClientId);
  renderClientsView();
  showToast("Client created");
}

async function updateClient(event) {
  event.preventDefault();
  const cl = selectedClient();
  if (!cl) throw new Error("Choose a client first");
  const body = {
    company_name: getFormValue("#client-edit-company"),
    cr_number: getFormValue("#client-edit-cr"),
    vat_number: getFormValue("#client-edit-vat"),
    signatory_name: getFormValue("#client-edit-signatory"),
    phone: getFormValue("#client-edit-phone"),
    email: getFormValue("#client-edit-email"),
    company_email: getFormValue("#client-edit-company-email"),
    street: getFormValue("#client-edit-street"),
    city: getFormValue("#client-edit-city"),
    postcode: getFormValue("#client-edit-postcode"),
    country: getFormValue("#client-edit-country"),
    national_address: getFormValue("#client-edit-national"),
  };
  await api(`/api/vendors/clients/${cl.id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  await loadClients();
  renderClientsView();
  showToast("Client saved");
}

async function generateContracts(event) {
  event?.preventDefault();
  const taskId = getFormValue("#generate-task") || selectedTask()?.id;
  const rawIds = getFormValue("#generate-subtasks");
  const subtask_ids = rawIds
    ? rawIds.split(",").map((id) => Number(id.trim())).filter(Boolean)
    : null;
  const template_key = getFormValue("#generate-template") || null;

  const generated = await api("/api/contracts/generate", {
    method: "POST",
    body: JSON.stringify({ task_id: taskId, subtask_ids, template_key }),
  });

  await loadContracts();
  renderContractsView();
  const pdfCount = generated.filter((item) => item.pdf_path).length;
  const failed = generated.filter((item) => !item.pdf_path);
  const pdfDisabled = failed.length > 0 && failed.every((item) => /disabled/i.test(item.pdf_error || ""));
  if (failed.length === 0) {
    showToast(`Generated ${generated.length} DOCX and ${pdfCount} PDF`);
  } else if (pdfDisabled) {
    // PDF conversion is turned off on this server (memory-safe mode) — the
    // Word docs generated fine, so this is a success, not an error.
    showToast(`Generated ${generated.length} Word document${generated.length === 1 ? "" : "s"}`);
  } else {
    const firstReason = failed[0].pdf_error || "see uvicorn logs";
    showToast(
      `Generated ${generated.length} DOCX, ${pdfCount} PDF — ${failed.length} PDF failed (${firstReason})`,
      "error",
    );
  }
}

async function createVendor(event) {
  event.preventDefault();
  const payload = readVendorFormPayload("vendor");
  if (!payload.name) throw new Error("Vendor name is required");
  if (!payload.category_id) throw new Error("Pick a category");
  const created = await api("/api/vendors/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.vendors = [{ ...created, bank_accounts: created.bank_accounts || [] }, ...state.vendors];
  state.selectedVendorId = String(created.id);
  localStorage.setItem("aq_selected_vendor", state.selectedVendorId);
  renderVendorsView();
  showToast("Vendor created");
}

/**
 * Save flow for the Design C vendor editor modal.
 *
 * Edit mode  → PATCH /api/vendors/{id} with the top-section fields,
 *              then for each BankDraft:
 *                deleted + has id  → DELETE  /api/vendors/bank-accounts/{id}
 *                no id + non-empty → POST    /api/vendors/{id}/bank-accounts
 *                has id + changed  → PATCH   /api/vendors/bank-accounts/{id}
 *
 * Create mode → POST /api/vendors/ (no banks in payload); the user
 *               re-opens the just-created vendor to add banks.
 *
 * Errors are surfaced inside the modal — the modal stays open so the
 * user can retry without losing typed bank fields.
 */
/**
 * Upload one or more files into a slot for the current edit-mode
 * vendor. Sequential so the first 25-MB rejection surfaces before
 * subsequent uploads consume bandwidth. After all uploads we refetch
 * the list so the new rows appear.
 *
 * Uses a raw fetch + multipart body — the api() helper sets a JSON
 * Content-Type which fights with multipart boundaries.
 */
async function uploadVendorEditorFiles(slot, files) {
  const vendor = state.vendorEditorTarget;
  if (!vendor) return;
  captureVendorEditorTopFields();
  for (const f of files) {
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("slot", slot);
      const resp = await fetch(`${API_BASE}/api/vendors/${vendor.id}/files`, {
        method: "POST",
        body: fd,
        headers: authHeaders(false),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(txt || `Upload failed (${resp.status})`);
      }
    } catch (err) {
      state.vendorEditorError = err?.message || String(err);
      renderVendorsView();
      return;
    }
  }
  await loadVendorEditorFiles(vendor.id);
}

/** Open a signed-URL download for a single vendor file. */
async function downloadVendorFile(fileId) {
  try {
    const data = await api(`/api/vendors/files/${encodeURIComponent(fileId)}/download`, { body: undefined });
    if (!data?.url) throw new Error("No URL returned");
    // Open in a new tab so the host page keeps the modal open. The
    // server already appended `download=<filename>` so the browser
    // saves with the original filename rather than the storage path.
    const a = document.createElement("a");
    a.href = data.url;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err) {
    state.vendorEditorError = err?.message || String(err);
    renderVendorsView();
  }
}

/** Confirm + delete a vendor file. Refreshes the list on success. */
async function deleteVendorFile(fileId) {
  if (!window.confirm("Delete this file? This cannot be undone.")) return;
  captureVendorEditorTopFields();
  try {
    await api(`/api/vendors/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
    const vendor = state.vendorEditorTarget;
    if (vendor) await loadVendorEditorFiles(vendor.id);
  } catch (err) {
    state.vendorEditorError = err?.message || String(err);
    renderVendorsView();
  }
}

async function saveVendorEditor() {
  if (state.vendorEditorSaving) return;
  // Snapshot the live DOM values into the draft so the upcoming
  // re-render (which switches to a Saving... state) doesn't wipe
  // unsaved text from the inputs.
  captureVendorEditorTopFields();
  state.vendorEditorSaving = true;
  state.vendorEditorError = "";
  renderVendorsView();

  try {
    const payload = readVendorFormPayload("vendor-edit");
    if (!payload.name) throw new Error("Vendor name is required");
    if (!payload.category_id) throw new Error("Pick a category");
    const target = state.vendorEditorTarget;

    let vendorId;
    if (target) {
      await api(`/api/vendors/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      vendorId = target.id;
    } else {
      const created = await api("/api/vendors/", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      vendorId = created.id;
    }

    // Bank deltas (edit mode only — create flow defers to the next open).
    if (target) {
      for (const b of state.vendorEditorBanks) {
        if (b.deleted && b.id != null) {
          await api(`/api/vendors/bank-accounts/${b.id}`, { method: "DELETE" });
          continue;
        }
        const bankPayload = {
          bank_name: b.bank_name.trim(),
          account_name: b.account_name.trim(),
          iban: b.iban.trim(),
          account_number: b.account_number.trim(),
          swift_code: b.swift_code.trim(),
        };
        const isAllEmpty = Object.values(bankPayload).every((v) => !v);
        if (b.id == null) {
          if (isAllEmpty) continue;
          await api(`/api/vendors/${vendorId}/bank-accounts`, {
            method: "POST",
            body: JSON.stringify(bankPayload),
          });
        } else {
          await api(`/api/vendors/bank-accounts/${b.id}`, {
            method: "PATCH",
            body: JSON.stringify(bankPayload),
          });
        }
      }
    }

    await loadVendors();
    state.vendorEditorSaving = false;
    closeVendorEditor();
    showToast(target ? "Vendor saved" : "Vendor created");
  } catch (err) {
    state.vendorEditorError = err?.message || String(err);
    state.vendorEditorSaving = false;
    renderVendorsView();
  }
}

async function updateVendor(event) {
  event.preventDefault();
  const vendorId = getFormValue("#vendor-edit-select");
  if (!vendorId) throw new Error("Choose a vendor first");
  const payload = readVendorFormPayload("vendor-edit");
  const updated = await api(`/api/vendors/${vendorId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  state.selectedVendorId = String(vendorId);
  localStorage.setItem("aq_selected_vendor", state.selectedVendorId);
  state.vendors = state.vendors.map((vendor) => String(vendor.id) === String(updated.id) ? updated : vendor);
  renderVendorsView();
  showToast("Vendor saved");
}

async function deleteSelectedVendor() {
  const vendor = selectedVendor();
  if (!vendor) throw new Error("Choose a vendor first");

  await api(`/api/vendors/${vendor.id}`, { method: "DELETE" });
  state.vendors = state.vendors.filter((item) => String(item.id) !== String(vendor.id));
  // Leave the right-side panel blank after delete instead of jumping to the
  // first remaining vendor — the user should pick the next one themselves.
  state.selectedVendorId = "";
  state.selectedBankId = "";
  localStorage.removeItem("aq_selected_vendor");
  renderVendorsView();
  showToast("Vendor deleted");
}

async function addBank(event) {
  event.preventDefault();
  const vendorId = getFormValue("#bank-vendor");
  const iban = normalizeIban(getFormValue("#bank-iban"));
  const created = await api(`/api/vendors/${vendorId}/bank-accounts`, {
    method: "POST",
    body: JSON.stringify({
      vendor_id: Number(vendorId),
      bank_name: getFormValue("#bank-name"),
      account_name: getFormValue("#bank-account-name"),
      iban,
      account_number: getFormValue("#bank-account-number"),
      swift_code: getFormValue("#bank-swift"),
    }),
  });
  state.vendors = state.vendors.map((vendor) => {
    if (String(vendor.id) !== String(vendorId)) return vendor;
    const banks = vendor.bank_accounts || [];
    const exists = banks.some((bank) => String(bank.id) === String(created.id));
    return {
      ...vendor,
      bank_accounts: exists
        ? banks.map((bank) => String(bank.id) === String(created.id) ? created : bank)
        : [...banks, created],
    };
  });
  state.selectedVendorId = String(vendorId);
  state.selectedBankId = String(created.id);
  event.target.reset();
  renderVendorsView();
  showToast("Bank account saved");
}

async function updateBank(event) {
  event.preventDefault();
  const bankId = getFormValue("#bank-edit-select");
  if (!bankId) throw new Error("Choose a bank account first");
  const updated = await api(`/api/vendors/bank-accounts/${bankId}`, {
    method: "PATCH",
    body: JSON.stringify({
      bank_name: getFormValue("#bank-edit-name"),
      account_name: getFormValue("#bank-edit-account-name"),
      iban: normalizeIban(getFormValue("#bank-edit-iban")),
      account_number: getFormValue("#bank-edit-account-number"),
      swift_code: getFormValue("#bank-edit-swift"),
    }),
  });
  state.selectedBankId = String(bankId);
  state.vendors = state.vendors.map((vendor) => ({
    ...vendor,
    bank_accounts: (vendor.bank_accounts || []).map((bank) => String(bank.id) === String(updated.id) ? updated : bank),
  }));
  renderVendorsView();
  showToast("Bank account saved");
}

async function uploadTemplate(event) {
  event.preventDefault();
  const key = getFormValue("#upload-key");
  const file = document.querySelector("#upload-file")?.files?.[0];
  if (!file) throw new Error("Choose a DOCX file first");
  const form = new FormData();
  form.append("file", file);
  await api(`/api/templates/${key}/upload`, {
    method: "POST",
    body: form,
  });
  event.target.reset();
  await loadTemplates();
  renderTemplatesView();
  showToast("Template uploaded");
}

async function createTemplateSlot(event) {
  event.preventDefault();
  const name = getFormValue("#new-template-name");
  const key = getFormValue("#new-template-key");
  const file = document.querySelector("#new-template-file")?.files?.[0];
  if (!name) throw new Error("Template name is required");
  if (!file) throw new Error("Choose a DOCX file first");

  const form = new FormData();
  form.append("display_name", name);
  if (key) form.append("key", key);
  form.append("file", file);

  const created = await api("/api/templates/slots", {
    method: "POST",
    body: form,
  });
  event.target.reset();
  await loadTemplates();
  renderTemplatesView();
  showToast(`Template slot created: ${created.display_name}`);
}

async function setDefaultTemplate(key) {
  if (!isAdmin()) throw new Error("Admin access required");
  const updated = await api(`/api/templates/${encodeURIComponent(key)}/default`, { method: "POST" });
  await loadTemplates();
  renderTemplatesView();
  showToast(`${updated.display_name} is now the default`);
}

async function deleteTemplate(key) {
  if (!isAdmin()) throw new Error("Admin access required");
  const result = await api(`/api/templates/${encodeURIComponent(key)}`, { method: "DELETE" });
  await loadTemplates();
  renderTemplatesView();
  showToast(result?.slot_deleted ? "Template slot deleted" : "Template removed");
}

async function saveProfile(event) {
  event.preventDefault();
  const body = {
    full_name: getFormValue("#profile-name"),
    email: getFormValue("#profile-email"),
    profile_color: getFormValue("#profile-color"),
  };
  const password = getFormValue("#profile-password");
  if (password) body.new_password = password;

  state.user = await api("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  renderUser();
  renderSettingsView();
  showToast("Profile saved");
}

document.addEventListener("submit", async (event) => {
  const submitter = event.submitter || event.target.querySelector("button[type='submit']");
  try {
    setButtonLoading(submitter, true);
    if (event.target.id === "login-form") {
      event.preventDefault();
      await login(false);
    } else if (event.target.id === "signup-form") {
      event.preventDefault();
      await login(true);
    } else if (event.target.id === "task-form") {
      await saveTask(event);
      // Close slide-over after a successful save.
      state.taskEditorOpen = false;
      await renderTasksView();
    } else if (event.target.id === "subtask-form") {
      await addSubtask(event);
      // Close slide-over after a successful add.
      state.subtaskEditorOpen = false;
      await renderTasksView();
    } else if (event.target.id === "vendor-form") {
      await createVendor(event);
    } else if (event.target.id === "vendor-edit-form") {
      await updateVendor(event);
    } else if (event.target.id === "bank-form") {
      await addBank(event);
    } else if (event.target.id === "bank-edit-form") {
      await updateBank(event);
    } else if (event.target.id === "client-edit-form") {
      await updateClient(event);
    } else if (event.target.id === "client-form") {
      await createClient(event);
    } else if (event.target.id === "generate-form") {
      await generateContracts(event);
    } else if (event.target.id === "template-upload-form") {
      await uploadTemplate(event);
    } else if (event.target.id === "template-create-form") {
      await createTemplateSlot(event);
    } else if (event.target.id === "profile-form") {
      await saveProfile(event);
    } else if (event.target.id === "invite-form") {
      event.preventDefault();
      await sendContractInvite();
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setButtonLoading(submitter, false);
  }
});

// (Signup is now driven by the form's submit handler — no separate click.)

els.logoutButton.addEventListener("click", () => {
  clearStoredToken();
  state.token = "";
  state.user = null;
  setSignedIn(false);
  renderUser();
});

els.refreshButton.addEventListener("click", async () => {
  try {
    setButtonLoading(els.refreshButton, true);
    await refreshAll();
    renderCurrentView();
    showToast("Workspace refreshed");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    setButtonLoading(els.refreshButton, false);
  }
});

// Debounced search: re-render the filtered list only after the user pauses
// typing (not on every keystroke), then restore focus + caret so typing
// stays smooth. The input itself updates natively as you type; only the
// (expensive) list re-render waits. Tune the delay here.
let _searchRenderTimer = null;
function debouncedSearchRender(renderFn, inputId) {
  if (_searchRenderTimer) clearTimeout(_searchRenderTimer);
  _searchRenderTimer = setTimeout(() => {
    const restore = () => {
      const el = document.getElementById(inputId);
      if (el) {
        el.focus();
        const len = el.value.length;
        try { el.setSelectionRange(len, len); } catch (_) {}
      }
    };
    const result = renderFn();
    if (result && typeof result.then === "function") result.then(restore);
    else restore();
  }, 250);
}

document.addEventListener("input", (event) => {
  if (event.target.id === "task-search") {
    state.search = event.target.value;
    debouncedSearchRender(renderTasksView, "task-search");
  }
  if (event.target.id === "vendor-search") {
    state.vendorSearch = event.target.value;
    debouncedSearchRender(renderVendorsView, "vendor-search");
  }
  if (event.target.id === "client-search") {
    state.clientSearch = event.target.value;
    debouncedSearchRender(renderClientsView, "client-search");
  }
  if (event.target.id === "contract-search") {
    state.contractSearch = event.target.value;
    debouncedSearchRender(renderContractsView, "contract-search");
  }
  if (event.target.id === "sub-license") {
    syncSubtaskVendorFields();
    // Re-render the suggestion dropdown on every keystroke. We reset
    // the hover index so the keyboard arrow nav starts from the top.
    subLicenseHoverIndex = -1;
    renderSubLicenseSuggestions(event.target.value);
  }
  // Vendor editor bank inputs — write to state on every keystroke so
  // saves capture in-flight text. We deliberately don't re-render
  // here, which would yank focus from the input mid-type.
  if (event.target.classList?.contains("ve-bank-input")) {
    const key = event.target.dataset.key;
    const field = event.target.dataset.field;
    state.vendorEditorBanks = state.vendorEditorBanks.map((b) =>
      b.localKey === key ? { ...b, [field]: event.target.value } : b
    );
  }
  if (event.target.classList.contains("platform-handle")) {
    const raw = event.target.value;
    event.target.value = raw.replace(/^@+/, "");
    syncPlatformPayload();
  }
});

document.addEventListener("change", async (event) => {
  try {
    if (event.target.id === "task-limit") {
      state.taskLimit = Math.max(5, Number(event.target.value) || 0);
      if (Number(event.target.value) === 0) state.taskLimit = 0;
      localStorage.setItem("aq_task_limit", String(state.taskLimit));
      await renderTasksView();
    }
    // ── Quick filters (per view) ──
    const fid = event.target.id;
    if (fid === "task-status-filter") { state.taskStatusFilter = event.target.value; await renderTasksView(); return; }
    if (fid === "task-gen-filter") { state.taskGenFilter = event.target.value; await renderTasksView(); return; }
    if (fid === "task-paid-filter") { state.taskPaidFilter = event.target.value; await renderTasksView(); return; }
    if (fid === "vendor-type-filter") { state.vendorTypeFilter = event.target.value; renderVendorsView(); return; }
    if (fid === "vendor-license-filter") { state.vendorLicenseFilter = event.target.value; renderVendorsView(); return; }
    if (fid === "vendor-complete-filter") { state.vendorCompleteFilter = event.target.value; renderVendorsView(); return; }
    if (fid === "client-cr-filter") { state.clientCrFilter = event.target.value; renderClientsView(); return; }
    if (fid === "contract-files-filter") { state.contractFilesFilter = event.target.value; renderContractsView(); return; }
    if (event.target.id === "sub-iban") {
      syncSubtaskBankPreview();
    }
    // Vendor editor file picker — when the user picks a file the
    // <input type="file"> emits a change event. The slot was stashed
    // on its dataset by the trigger handler.
    if (event.target.classList?.contains("ve-file-input")) {
      const files = Array.from(event.target.files || []);
      const slot = event.target.dataset.slot || "";
      // Reset the input so picking the same filename again works.
      event.target.value = "";
      if (files.length > 0) {
        uploadVendorEditorFiles(slot, files);
      }
      return;
    }
    // Vendor editor: bank field updates write straight to state so the
    // next render reflects the current input. No re-render here — that
    // would steal focus mid-typing.
    if (event.target.classList?.contains("ve-bank-input")) {
      const key = event.target.dataset.key;
      const field = event.target.dataset.field;
      state.vendorEditorBanks = state.vendorEditorBanks.map((b) =>
        b.localKey === key ? { ...b, [field]: event.target.value } : b
      );
    }
    // Toggle the multi-service free-text box when Ad Type changes.
    // Show it only when the selected option is "Multi Service".
    if (event.target.id === "sub-ad-type") {
      const customLabel = document.getElementById("sub-ad-type-custom-label");
      const customInput = document.getElementById("sub-ad-type-custom");
      if (customLabel) {
        const isMulti = (event.target.value || "").trim().toLowerCase() === "multi service";
        customLabel.style.display = isMulti ? "" : "none";
        if (!isMulti && customInput) customInput.value = "";
      }
    }
    // Vendor form category changes — drive ID/License + per-category
    // field visibility. Both the New and Edit forms route through
    // syncVendorCategoryVisibility, picking the right prefix.
    if (event.target.id === "vendor-category") {
      syncVendorCategoryVisibility("vendor");
    }
    if (event.target.id === "vendor-edit-category") {
      // If the modal is open, we capture current text + re-render so
      // the ID/License + per-category fields toggle correctly. Outside
      // the modal (legacy form) fall back to the lightweight visibility
      // sync that doesn't re-render.
      if (state.vendorEditorOpen) {
        captureVendorEditorTopFields();
        // Override the cached category with the new selection so the
        // re-render reflects it instead of reverting to the saved value.
        if (state.vendorEditorDraft) state.vendorEditorDraft.category = event.target.value;
        renderVendorsView();
      } else {
        syncVendorCategoryVisibility("vendor-edit");
      }
    }
    if (event.target.classList.contains("platform-checkbox")) {
      renderPlatformHandleFields();
    }
    if (event.target.id === "vendor-edit-select") {
      state.selectedVendorId = event.target.value;
      localStorage.setItem("aq_selected_vendor", state.selectedVendorId);
      state.selectedBankId = "";
      renderVendorsView();
    }
    if (event.target.id === "bank-edit-select") {
      state.selectedBankId = event.target.value;
      renderVendorsView();
    }
    if (event.target.id === "cc-client-select") {
      const clientId = event.target.value;
      const detailsDiv = document.querySelector("#cc-client-details");
      const brandSelect = document.querySelector("#cc-brand-select");
      if (!clientId) {
        if (detailsDiv) detailsDiv.innerHTML = "";
        if (brandSelect) brandSelect.innerHTML = '<option value="">-- select client first --</option>';
        return;
      }
      const cl = state.clients.find((c) => String(c.id) === String(clientId));
      if (detailsDiv && cl) {
        detailsDiv.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.25rem 1rem">
            <span><strong>Company:</strong> ${escapeHtml(cl.company_name || cl.name || "")}</span>
            <span><strong>CR:</strong> ${escapeHtml(cl.cr_number || "—")}</span>
            <span><strong>VAT:</strong> ${escapeHtml(cl.vat_number || "—")}</span>
            <span><strong>Signatory:</strong> ${escapeHtml(cl.signatory_name || "—")}</span>
            <span><strong>Phone:</strong> ${escapeHtml(cl.contact_phone || cl.phone || "—")}</span>
            <span><strong>Email:</strong> ${escapeHtml(cl.contact_email || cl.email || "—")}</span>
            <span style="grid-column:1/-1"><strong>Address:</strong> ${escapeHtml([cl.street, cl.city, cl.postcode, cl.country].filter(Boolean).join(", ") || "—")}</span>
          </div>
        `;
      }
      // Load brands for this client
      if (brandSelect) {
        brandSelect.innerHTML = '<option value="">Loading...</option>';
        try {
          const brands = await api(`/api/brands?client_id=${encodeURIComponent(clientId)}`, { body: undefined });
          if (brands.length) {
            brandSelect.innerHTML = brands.map((b) =>
              `<option value="${encodeAttr(b.id)}">${escapeHtml(b.brand_name)}</option>`
            ).join("");
          } else {
            brandSelect.innerHTML = '<option value="">No brands — will use client name</option>';
          }
        } catch {
          brandSelect.innerHTML = '<option value="">Error loading brands</option>';
        }
      }
    }
    if (event.target.id === "task-type") {
      // Auto-switch to client mode when client_contract is selected
      if (event.target.value === "client_contract" && !state.clientMode) {
        state.clientMode = true;
        await renderTasksView();
      } else if (event.target.value !== "client_contract" && state.clientMode) {
        state.clientMode = false;
        await renderTasksView();
      }
    }
    // Per-row subtask checkboxes — toggle membership in selectedSubtaskIds.
    // Surgically refresh the Generate menu so "Selected only" enables and
    // its badge counts up as the user ticks rows. Doing a full re-render
    // here would steal focus mid-click; updating just the dropdown handles
    // are enough. (Bug reported 2026-05-21: partial selection appeared
    // broken because the menu item stayed disabled with badge "0".)
    if (event.target.classList.contains("subtask-pick")) {
      const set = state.selectedSubtaskIds || (state.selectedSubtaskIds = new Set());
      const id = String(event.target.dataset.id || "");
      if (event.target.checked) set.add(id); else set.delete(id);
      refreshGenerateSelectedHandle();
    }
    // Header "select all" toggle
    if (event.target.id === "subtask-pick-all") {
      const set = state.selectedSubtaskIds || (state.selectedSubtaskIds = new Set());
      if (event.target.checked) {
        state.subtasks.forEach((s) => set.add(String(s.id)));
      } else {
        set.clear();
      }
      // Re-render so individual checkboxes follow.
      renderTasksView();
    }
    // Task multi-select (batch delete) — per-row checkbox.
    if (event.target.classList.contains("task-pick")) {
      const set = state.taskSel || (state.taskSel = new Set());
      const id = String(event.target.dataset.id || "");
      if (event.target.checked) set.add(id); else set.delete(id);
      renderTasksView();   // refresh the bulk bar + select-all state
    }
    // Task "select all" toggle — selects every currently visible task row.
    if (event.target.id === "task-pick-all") {
      const set = state.taskSel || (state.taskSel = new Set());
      if (event.target.checked) {
        document.querySelectorAll(".task-pick").forEach((cb) => set.add(String(cb.dataset.id)));
      } else {
        set.clear();
      }
      renderTasksView();
    }
  } catch (error) {
    showToast(error.message, "error");
  }
});

// Escape closes whichever slide-over is open + the Generate dropdown.
document.addEventListener("keydown", async (event) => {
  // Vendor license autocomplete: arrow keys move the highlight, Enter
  // picks the highlighted row, Escape closes the dropdown without
  // closing the slide-over.
  if (event.target?.id === "sub-license") {
    const box = document.getElementById("sub-license-suggestions");
    const rows = box ? Array.from(box.querySelectorAll(".autocomplete-row")) : [];
    if (rows.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        subLicenseHoverIndex = Math.min(rows.length - 1, subLicenseHoverIndex + 1);
        renderSubLicenseSuggestions(event.target.value);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        subLicenseHoverIndex = Math.max(0, subLicenseHoverIndex - 1);
        renderSubLicenseSuggestions(event.target.value);
        return;
      }
      if (event.key === "Enter") {
        const idx = subLicenseHoverIndex >= 0 ? subLicenseHoverIndex : 0;
        const row = rows[idx];
        if (row) {
          event.preventDefault();
          pickSubLicenseVendor(row.dataset.license || "");
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        hideSubLicenseSuggestions();
        return;
      }
    }
  }

  if (event.key !== "Escape") return;
  const popup = document.getElementById("generate-menu-popup");
  if (popup && !popup.hidden) {
    popup.hidden = true;
    return;
  }
  if (state.taskEditorOpen) {
    state.taskEditorOpen = false;
    await renderTasksView();
    return;
  }
  if (state.subtaskEditorOpen) {
    state.subtaskEditorOpen = false;
    await renderTasksView();
    return;
  }
});

// When the license input gains focus, show the full vendor list so the
// user has somewhere to start. This is what most "ComboBox" widgets do
// and matches how native datalists used to behave.
document.addEventListener("focusin", (event) => {
  if (event.target?.id === "sub-license") {
    subLicenseHoverIndex = -1;
    renderSubLicenseSuggestions(event.target.value);
  }
});

document.addEventListener("click", async (event) => {
  // ── Vendor editor modal handlers ────────────────────────────────
  const veAction = event.target.closest("[data-action]")?.dataset.action;
  // Close on overlay click (but not on a click inside the panel).
  if (event.target.classList?.contains("modal-backdrop") && event.target.dataset.action === "ve-close-bg") {
    closeVendorEditor();
    return;
  }
  if (veAction === "ve-close") { event.preventDefault(); closeVendorEditor(); return; }
  if (veAction === "ve-tab") {
    captureVendorEditorTopFields();
    const btn = event.target.closest("[data-action='ve-tab']");
    const tabType = btn?.dataset.tabType;
    if (tabType === "id") state.vendorEditorTab = { type: "id" };
    else if (tabType === "bank") state.vendorEditorTab = { type: "bank", localKey: btn.dataset.tabKey };
    renderVendorsView();
    return;
  }
  if (veAction === "ve-add-bank") {
    captureVendorEditorTopFields();
    const draft = emptyBankDraft();
    state.vendorEditorBanks.push(draft);
    state.vendorEditorTab = { type: "bank", localKey: draft.localKey };
    renderVendorsView();
    return;
  }
  if (veAction === "ve-remove-bank") {
    captureVendorEditorTopFields();
    const key = event.target.closest("[data-action='ve-remove-bank']")?.dataset.key;
    state.vendorEditorBanks = state.vendorEditorBanks.map((b) =>
      b.localKey === key ? { ...b, deleted: true } : b
    );
    state.vendorEditorTab = { type: "id" };
    renderVendorsView();
    return;
  }
  if (veAction === "ve-save") {
    await saveVendorEditor();
    return;
  }
  if (veAction === "edit-vendor") {
    const id = event.target.closest("[data-action='edit-vendor']")?.dataset.id;
    const v = state.vendors.find((x) => String(x.id) === String(id));
    if (v) openVendorEditor(v);
    return;
  }
  if (veAction === "open-new-vendor") {
    openVendorEditor(null);
    return;
  }
  if (veAction === "open-bulk-vendors") {
    state.bulkVendorOpen = true;
    state.bulkVendorError = "";
    state.bulkVendorFailed = [];
    renderVendorsView();
    return;
  }
  if (veAction === "bulk-close"
      || (veAction === "bulk-close-bg" && event.target.classList.contains("modal-backdrop"))) {
    if (state.bulkVendorBusy) return;   // do not close mid-run
    state.bulkVendorOpen = false;
    renderVendorsView();
    return;
  }
  if (veAction === "bulk-create") {
    await createVendorsBulk();
    return;
  }
  if (veAction === "ve-trigger-upload") {
    // The clickable span is paired with a sibling <input type="file">
    // inside the same <label>. Clicking the label naturally fires
    // the file picker — but we need to capture the slot from the
    // button before the file picker resolves.
    const span = event.target.closest("[data-action='ve-trigger-upload']");
    if (!span) return;
    const input = span.parentElement?.querySelector("input.ve-file-input");
    if (input) {
      input.dataset.slot = span.dataset.slot || "";
      input.click();
    }
    return;
  }
  if (veAction === "ve-download-file") {
    const fileId = event.target.closest("[data-action='ve-download-file']")?.dataset.fileId;
    if (fileId) downloadVendorFile(fileId);
    return;
  }
  if (veAction === "ve-delete-file") {
    const fileId = event.target.closest("[data-action='ve-delete-file']")?.dataset.fileId;
    if (fileId) deleteVendorFile(fileId);
    return;
  }

  // Vendor license autocomplete: row click picks the vendor.
  const acRow = event.target.closest("#sub-license-suggestions .autocomplete-row");
  if (acRow) {
    event.preventDefault();
    pickSubLicenseVendor(acRow.dataset.license || "");
    return;
  }
  // Outside-click dismiss for the autocomplete dropdown — close it
  // unless the click was on the input itself or inside the suggestions
  // panel (those have their own handlers).
  if (!event.target.closest(".autocomplete-wrap")) {
    hideSubLicenseSuggestions();
  }

  // Slide-over dismiss: clicking the dark overlay (but not the panel
  // inside) closes whichever editor is open.
  const overlay = event.target.closest("[data-dismiss-overlay]");
  if (overlay && event.target === overlay) {
    if (overlay.id === "task-editor-overlay") {
      state.taskEditorOpen = false;
      await renderTasksView();
    } else if (overlay.id === "subtask-editor-overlay") {
      state.subtaskEditorOpen = false;
      await renderTasksView();
    }
    return;
  }

  // Close the Generate dropdown when clicking anywhere outside it.
  const popup = document.getElementById("generate-menu-popup");
  if (popup && !popup.hidden) {
    const insideMenu = event.target.closest(".generate-menu");
    if (!insideMenu) popup.hidden = true;
  }

  const button = event.target.closest("button");
  const row = event.target.closest("tr[data-task-id]");
  const vendorCard = event.target.closest(".vendor-card[data-vendor-id]");
  // Task-group header expand/collapse — separate handler because the header
  // is a div, not a button. Inner buttons opt out via data-stop.
  const taskGroupHeader = event.target.closest('.task-group-header[data-action="toggle-task-group"]');

  try {
    const loadableButton = button && !button.classList.contains("nav-item") ? button : null;
    setButtonLoading(loadableButton, true);

    if (taskGroupHeader && (!button || !button.dataset.stop)) {
      // Click landed on the header itself, OR on an inner button that
      // does NOT have data-stop set. Toggle in either case.
      if (!button) {
        const tid = String(taskGroupHeader.dataset.taskId || "");
        if (tid) {
          const set = state.expandedTasks || (state.expandedTasks = new Set());
          if (set.has(tid)) set.delete(tid); else set.add(tid);
          renderContractsView();
        }
        return;
      }
    }

    if (row && !button) {
      // Switching task → wipe the subtask-selection set so IDs from the
      // previous task don't leak into Generate selected.
      if (String(state.selectedTaskId) !== String(row.dataset.taskId)) {
        state.selectedSubtaskIds = new Set();
      }
      state.selectedTaskId = row.dataset.taskId;
      localStorage.setItem("aq_selected_task", state.selectedTaskId);
      await renderTasksView();
      return;
    }

    if (vendorCard && !button) {
      // Click anywhere in the card (except an explicit Edit button)
      // toggles the inline expansion. Edit handler is wired via
      // data-action="edit-vendor" elsewhere.
      if (event.target.closest("[data-stop-card-click]")) return;
      const id = vendorCard.dataset.vendorId;
      state.expandedVendorId = String(state.expandedVendorId) === String(id) ? null : id;
      renderVendorsView();
      return;
    }

    const clientCard = event.target.closest(".vendor-card[data-client-id]");
    if (clientCard && !button) {
      state.selectedClientId = clientCard.dataset.clientId;
      localStorage.setItem("aq_selected_client", state.selectedClientId);
      renderClientsView();
      return;
    }

    // Operations "Recent tasks" rows are grid divs (not <tr>); open in Tasks.
    const opsRow = event.target.closest('[data-action="open-task"]');
    if (opsRow && !button) {
      const id = opsRow.dataset.id;
      if (id) {
        if (String(state.selectedTaskId) !== String(id)) state.selectedSubtaskIds = new Set();
        state.selectedTaskId = id;
        localStorage.setItem("aq_selected_task", id);
      }
      setView("tasks");
      return;
    }

    // Tasks-view grid rows (divs, not <tr>): select for the master/detail.
    // Skip when the click landed on the row's selection checkbox.
    const taskRow = event.target.closest(".cs-row[data-task-row]");
    if (taskRow && !button && !event.target.closest(".task-pick")) {
      const id = taskRow.dataset.id;
      if (String(state.selectedTaskId) !== String(id)) state.selectedSubtaskIds = new Set();
      state.selectedTaskId = id;
      localStorage.setItem("aq_selected_task", id);
      await renderTasksView();
      return;
    }

    // Clients-view grid rows: select for the edit form.
    const clientRow = event.target.closest(".cs-row[data-client-row]");
    if (clientRow && !button) {
      state.selectedClientId = clientRow.dataset.id;
      localStorage.setItem("aq_selected_client", state.selectedClientId);
      renderClientsView();
      return;
    }


    if (!button) return;
    const action = button.dataset.action;

    if (button.classList.contains("nav-item")) {
      setView(button.dataset.view);
      return;
    }

    // Close the Generate dropdown the moment any menu item is picked.
    if (button.classList.contains("generate-menu-item")) {
      const popup = document.getElementById("generate-menu-popup");
      if (popup) popup.hidden = true;
    }

    if (action === "export-excel") {
      await exportCurrentView();
      return;
    }
    if (action === "clear-filters") {
      if (state.view === "tasks") { state.taskStatusFilter = ""; state.taskGenFilter = ""; state.taskPaidFilter = ""; await renderTasksView(); }
      else if (state.view === "vendors") { state.vendorTypeFilter = ""; state.vendorLicenseFilter = ""; state.vendorCompleteFilter = ""; renderVendorsView(); }
      else if (state.view === "clients") { state.clientCrFilter = ""; renderClientsView(); }
      else if (state.view === "contracts") { state.contractFilesFilter = ""; renderContractsView(); }
      return;
    }
    if (action === "go-tasks") setView("tasks");
    if (action === "go-contracts") setView("contracts");
    if (action === "select-client") {
      if (button.dataset.id) {
        state.selectedClientId = button.dataset.id;
        localStorage.setItem("aq_selected_client", state.selectedClientId);
      }
      renderClientsView();
      return;
    }
    if (action === "set-theme") {
      const next = button.dataset.theme === "dark" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("aq_theme", next); } catch (e) {}
      const lbl = document.getElementById("theme-toggle-state");
      if (lbl) lbl.textContent = next === "dark" ? "Dark" : "Light";
      renderSettingsView();
      return;
    }
    if (action === "clear-task-form") {
      state.selectedTaskId = "__new__";
      state.selectedSubtaskIds = new Set();
      localStorage.setItem("aq_selected_task", state.selectedTaskId);
      await renderTasksView();
    }
    // ── Tasks-view redesign: slide-over editor + tab/dropdown toolbar ──
    if (action === "open-new-task") {
      state.taskEditorMode = "new";
      state.taskEditorOpen = true;
      state.selectedSubtaskIds = new Set();
      await renderTasksView();
      return;
    }
    if (action === "edit-task") {
      const id = button.dataset.id;
      if (id) {
        if (String(state.selectedTaskId) !== String(id)) {
          state.selectedSubtaskIds = new Set();
        }
        state.selectedTaskId = id;
        localStorage.setItem("aq_selected_task", id);
      }
      state.taskEditorMode = "edit";
      state.taskEditorOpen = true;
      await renderTasksView();
      return;
    }
    if (action === "close-task-editor") {
      state.taskEditorOpen = false;
      await renderTasksView();
      return;
    }
    if (action === "open-add-subtask") {
      state.subtaskEditorOpen = true;
      await renderTasksView();
      return;
    }
    if (action === "close-add-subtask") {
      state.subtaskEditorOpen = false;
      await renderTasksView();
      return;
    }
    if (action === "set-vendor-mode") {
      state.clientMode = false;
      await renderTasksView();
      return;
    }
    if (action === "set-client-mode") {
      state.clientMode = true;
      state.subtaskEditorOpen = false;
      await renderTasksView();
      return;
    }
    if (action === "toggle-generate-menu") {
      const popup = document.getElementById("generate-menu-popup");
      if (popup) {
        const wasHidden = popup.hidden;
        popup.hidden = !wasHidden;
        button.setAttribute("aria-expanded", wasHidden ? "true" : "false");
      }
      return;
    }
    if (action === "download-task-contracts" && button.dataset.taskId) {
      // Reuse the contracts-view download action by synthesizing a button.
      const tid = button.dataset.taskId;
      const list = state.contracts.filter((c) => String(c.task_id) === tid);
      for (const c of list) {
        if (c.pdf_path) {
          try { await downloadFile(`/api/contracts/download/pdf/${c.contract_id}`, prettyContractName(c, "pdf")); } catch (_) {}
        }
        try { await downloadFile(`/api/contracts/download/docx/${c.contract_id}`, prettyContractName(c, "docx")); } catch (_) {}
      }
      showToast(`Downloaded ${list.length} contract${list.length === 1 ? "" : "s"}`);
      const popup = document.getElementById("generate-menu-popup");
      if (popup) popup.hidden = true;
      return;
    }
    if (action === "duplicate-task") {
      const task = selectedTask();
      if (!task) throw new Error("Select a task first");
      const created = await api(`/api/tasks/${task.id}/duplicate`, { method: "POST" });
      state.selectedTaskId = created.id;
      localStorage.setItem("aq_selected_task", created.id);
      await loadTasks();
      await renderTasksView();
      showToast("Task duplicated");
    }
    if (action === "delete-task") {
      const task = selectedTask();
      if (!task) throw new Error("Select a task first");
      await api(`/api/tasks/${task.id}`, { method: "DELETE" });
      state.selectedTaskId = "";
      state.selectedSubtaskIds = new Set();
      await loadTasks();
      await renderTasksView();
      showToast("Task deleted");
    }
    if (action === "clear-task-sel") {
      state.taskSel = new Set();
      await renderTasksView();
      return;
    }
    if (action === "delete-tasks-bulk") {
      const ids = Array.from(state.taskSel || []);
      if (!ids.length) { showToast("No tasks selected", "error"); return; }
      if (!confirm(`Delete ${ids.length} task${ids.length === 1 ? "" : "s"} and all their subtasks? This cannot be undone.`)) return;
      let ok = 0;
      for (const id of ids) {
        try { await api(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }); ok++; }
        catch (_) { /* keep going; report total at end */ }
      }
      if (ids.includes(String(state.selectedTaskId))) {
        state.selectedTaskId = "";
        state.selectedSubtaskIds = new Set();
      }
      state.taskSel = new Set();
      await loadTasks();
      await renderTasksView();
      showToast(ok === ids.length
        ? `Deleted ${ok} task${ok === 1 ? "" : "s"}`
        : `Deleted ${ok} of ${ids.length} — some failed`);
      return;
    }
    if (action === "mark-paid") {
      const id = button.dataset.id;
      const sub = state.subtasks.find((item) => String(item.id) === String(id));
      const path = sub?.paid_at ? `/api/subtasks/${id}/unmark-paid` : `/api/subtasks/${id}/mark-paid`;
      await api(path, {
        method: "POST",
        body: JSON.stringify({ payment_note: "Marked from web UI" }),
      });
      await loadTasks();
      await renderTasksView();
      showToast(sub?.paid_at ? "Payment unmarked" : "Payment marked");
    }
    if (action === "delete-subtask") {
      await api(`/api/subtasks/${button.dataset.id}`, { method: "DELETE" });
      await loadTasks();
      await renderTasksView();
      showToast("Subtask deleted");
    }
    if (action === "generate-one") {
      const task = selectedTask();
      if (!task) throw new Error("Select a task first");
      const sid = Number(button.dataset.id);
      if (!sid) throw new Error("Subtask id missing");
      await generateForSubtasks(task.id, [sid], "Generated 1 contract.");
    }
    if (action === "generate-selected") {
      const task = selectedTask();
      if (!task) throw new Error("Select a task first");
      const set = state.selectedSubtaskIds || new Set();
      const ids = Array.from(set).map(Number).filter(Boolean);
      if (ids.length === 0) {
        showToast("Tick at least one subtask first, or use Generate ALL", "error");
        return;
      }
      await generateForSubtasks(task.id, ids, `Generated ${ids.length} contract${ids.length === 1 ? "" : "s"}.`);
    }
    if (action === "generate-all") {
      const task = selectedTask();
      if (!task) throw new Error("Select a task first");
      if (!state.subtasks.length) {
        showToast("This task has no subtasks", "error");
        return;
      }
      await generateForSubtasks(task.id, null, `Generated ${state.subtasks.length} contract${state.subtasks.length === 1 ? "" : "s"}.`);
    }
    if (action === "clear-subtask-sel") {
      state.selectedSubtaskIds = new Set();
      await renderTasksView();
      return;
    }
    if (action === "toggle-client-mode") {
      state.clientMode = !state.clientMode;
      await renderTasksView();
    }
    if (action === "generate-client-contract") {
      if (state.clientMode) {
        // Use inline form values instead of modal
        const task = selectedTask();
        if (!task) { showToast("Select a task first", "error"); return; }
        const clientId = getFormValue("#cc-client-select");
        if (!clientId) { showToast("Select a client first", "error"); return; }
        const brandId = getFormValue("#cc-brand-select") || null;
        const amount = getFormValue("#cc-total-amount") || "0";
        button.disabled = true;
        button.textContent = "Generating...";
        try {
          const result = await api("/api/contracts/generate-client", {
            method: "POST",
            body: JSON.stringify({
              task_id: task.id,
              client_id: clientId,
              brand_id: brandId,
              total_amount: amount,
            }),
          });
          await loadContracts();
          setView("contracts");
          renderContractsView();
          const msg = result.pdf_path
            ? "Client contract generated (DOCX + PDF)"
            : `Client contract generated (DOCX only — ${result.pdf_error || "PDF failed"})`;
          showToast(msg, result.pdf_path ? "success" : "warn");
        } catch (err) {
          showToast(`Generation failed: ${err.message || err}`, "error");
        }
      } else {
        showClientContractModal();
      }
    }
    if (action === "refresh-contracts") {
      await loadContracts();
      renderContractsView();
    }
    if (action === "download-pdf") {
      const c = (state.contracts || []).find((x) => x.contract_id === button.dataset.id);
      await downloadFile(`/api/contracts/download/pdf/${button.dataset.id}`, prettyContractName(c || { contract_id: button.dataset.id }, "pdf"));
    }
    if (action === "download-docx") {
      const c = (state.contracts || []).find((x) => x.contract_id === button.dataset.id);
      await downloadFile(`/api/contracts/download/docx/${button.dataset.id}`, prettyContractName(c || { contract_id: button.dataset.id }, "docx"));
    }
    if (action === "regenerate-contract") {
      if (!button.dataset.id) return;
      await regenerateContract(button.dataset.id);
    }
    if (action === "replace-contract") {
      // Admin-only "I edited this contract, upload my version" flow.
      // One picker that accepts both .pdf and .docx; the server endpoint
      // is selected by the extension of whatever file the user picks.
      if (!button.dataset.id) return;
      await openReplaceFilePicker(button.dataset.id);
    }
    if (action === "toggle-task-group") {
      const tid = String(button.dataset.taskId || button.closest("[data-task-id]")?.dataset?.taskId || "");
      if (!tid) return;
      const set = state.expandedTasks || (state.expandedTasks = new Set());
      if (set.has(tid)) set.delete(tid); else set.add(tid);
      renderContractsView();
    }
    if (action === "download-all-task") {
      const tid = String(button.dataset.taskId);
      const list = state.contracts.filter((c) => String(c.task_id) === tid);
      // Prefer PDF, but fall back to the Word doc when there's no PDF (e.g.
      // PDF generation is disabled on the server) so "Download all" still works.
      let pdfCount = 0;
      let docxCount = 0;
      for (const c of list) {
        if (c.pdf_path) {
          try { await downloadFile(`/api/contracts/download/pdf/${c.contract_id}`, prettyContractName(c, "pdf")); pdfCount++; }
          catch (_) {}
        } else {
          try { await downloadFile(`/api/contracts/download/docx/${c.contract_id}`, prettyContractName(c, "docx")); docxCount++; }
          catch (_) {}
        }
      }
      const parts = [];
      if (pdfCount) parts.push(`${pdfCount} PDF${pdfCount === 1 ? "" : "s"}`);
      if (docxCount) parts.push(`${docxCount} Word doc${docxCount === 1 ? "" : "s"}`);
      showToast(parts.length ? `Downloaded ${parts.join(" · ")}` : "Nothing to download");
    }
    if (action === "delete-contract") {
      if (!isAdmin()) { showToast("Admin only", "error"); return; }
      // Confirm prompt removed per user request — deletion is now one-click.
      await api(`/api/contracts/${button.dataset.id}`, { method: "DELETE" });
      await loadContracts();
      renderContractsView();
      showToast("Contract deleted");
    }
    if (action === "delete-task-contracts") {
      if (!isAdmin()) { showToast("Admin only", "error"); return; }
      const tid = String(button.dataset.taskId);
      const list = state.contracts.filter((c) => String(c.task_id) === tid);
      await api(`/api/contracts/task/${tid}`, { method: "DELETE" });
      await loadContracts();
      renderContractsView();
      showToast(`Deleted ${list.length} contract${list.length === 1 ? "" : "s"}`);
    }
    if (action === "scan-templates") {
      const scan = await api("/api/templates/scan", { method: "POST" });
      await loadTemplates();
      renderTemplatesView();
      showToast(`Found ${scan.found.length}, missing ${scan.missing.length}`);
    }
    if (action === "select-template-upload") {
      const select = document.querySelector("#upload-key");
      const file = document.querySelector("#upload-file");
      if (select) select.value = button.dataset.key;
      if (file) file.focus();
    }
    if (action === "set-default-template") {
      await setDefaultTemplate(button.dataset.key);
    }
    if (action === "delete-template") {
      await deleteTemplate(button.dataset.key);
    }
    if (action === "load-vendors") {
      await loadVendors();
      renderVendorsView();
    }
    if (action === "refresh-clients") {
      await loadClients();
      renderClientsView();
    }
    if (action === "delete-client") {
      const cl = selectedClient();
      if (!cl) throw new Error("Choose a client first");
      await api(`/api/vendors/clients/${cl.id}`, { method: "DELETE" });
      state.clients = state.clients.filter((c) => String(c.id) !== String(cl.id));
      state.selectedClientId = "";
      localStorage.removeItem("aq_selected_client");
      renderClientsView();
      showToast("Client deleted");
    }
    if (action === "delete-vendor") {
      // Directory rows pass the vendor id explicitly; select it first so
      // deleteSelectedVendor() (which reads state.selectedVendorId) targets
      // the right row even when the vendor wasn't already selected.
      if (button.dataset.id) {
        state.selectedVendorId = button.dataset.id;
        localStorage.setItem("aq_selected_vendor", state.selectedVendorId);
      }
      await deleteSelectedVendor();
    }
    if (action === "approve-vendor" || action === "reject-vendor") {
      const approved = action === "approve-vendor";
      await api(`/api/vendors/pending/vendors/${button.dataset.id}/action`, {
        method: "POST",
        body: JSON.stringify({ action: approved ? "approved" : "rejected" }),
      });
      await loadVendors();
      await loadPendingData();
      renderVendorsView();
      showToast(approved ? "Vendor approved" : "Vendor rejected");
    }
    if (action === "approve-client" || action === "reject-client") {
      const approved = action === "approve-client";
      await api(`/api/vendors/pending/clients/${button.dataset.id}/action`, {
        method: "POST",
        body: JSON.stringify({ action: approved ? "approved" : "rejected" }),
      });
      await loadPendingData();
      renderClientsView();
      showToast(approved ? "Client approved" : "Client rejected");
    }
    if (action === "create-backup") {
      await api("/api/settings/backups/create", { method: "POST" });
      await loadAdminData();
      renderSettingsView();
      showToast("Backup created");
    }
    if (action === "copy-invite") {
      const link = button.dataset.link || "";
      if (!link) return;
      try {
        await navigator.clipboard.writeText(link);
        showToast("Invite link copied");
      } catch {
        // Fallback for browsers without clipboard API permission.
        window.prompt("Copy this invite link:", link);
      }
    }
    if (action === "revoke-invite") {
      if (!isAdmin()) { showToast("Admin only", "error"); return; }
      await api(`/api/auth/invites/${button.dataset.id}`, { method: "DELETE" });
      await loadAdminData();
      renderSettingsView();
      showToast("Invite revoked");
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    const loadableButton = button && !button.classList.contains("nav-item") ? button : null;
    setButtonLoading(loadableButton, false);
  }
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.classList.toggle("active", button.dataset.view === state.view);
});

/**
 * Read ?invite=TOKEN from the URL and pre-fill the signup form. Called
 * once at bootstrap. Only valid invites are honored — if the token is
 * expired or already claimed the signup form is left empty and the
 * landing screen shows a small banner.
 */
async function loadInviteFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite");
    if (!token) return;
    const preview = await api(`/api/auth/invites/preview/${encodeURIComponent(token)}`, { body: undefined });
    if (preview?.claimed_at) {
      showToast("This invite has already been claimed.", "warn");
      return;
    }
    if (preview?.expires_at && new Date(preview.expires_at) < new Date()) {
      showToast("This invite has expired — ask your admin to send a new one.", "error");
      return;
    }
    state.pendingInviteFromUrl = { token, email: preview?.email, role: preview?.role, full_name: preview?.full_name };
    // Pre-fill what we can on the signup form.
    const emailInput = document.querySelector("#signup-email");
    const nameInput  = document.querySelector("#signup-full-name");
    const codeInput  = document.querySelector("#signup-invite-code");
    if (emailInput && preview?.email) {
      emailInput.value = preview.email;
      emailInput.setAttribute("readonly", "readonly");
    }
    if (nameInput && preview?.full_name) {
      nameInput.value = preview.full_name;
    }
    if (codeInput) {
      // Per-user token bypasses the shared code; hide the field to avoid confusion.
      const wrapper = codeInput.closest("label") || codeInput.parentElement;
      if (wrapper) wrapper.style.display = "none";
    }
    showToast(`You're invited as ${preview.role}. Pick a username and password to finish.`, "success");
  } catch (err) {
    // Don't block the page — just log a friendly warning.
    showToast(`Invite link issue: ${err.message || err}`, "error");
  }
}

/** Admin only — generate a 30-min invite code for new staff. */
async function sendContractInvite() {
  const email = safeText(document.querySelector("#invite-email")?.value || "");
  const name  = safeText(document.querySelector("#invite-name")?.value || "");
  const role  = document.querySelector("#invite-role")?.value || "member";
  if (!email) throw new Error("Email is required.");
  const result = await api("/api/auth/invites", {
    method: "POST",
    body: JSON.stringify({ email, full_name: name, role, expires_minutes: 30 }),
  });
  await loadAdminData();
  renderSettingsView();
  // Big toast with the code so admins can read it off-screen and share it
  // via WhatsApp / phone / in person.
  showToast(`Invite code: ${result.token} (expires in 30 min)`, "success");
  // Also copy code to clipboard for fast paste.
  try { await navigator.clipboard.writeText(result.token); } catch {}
}

// Bootstrap once the DOM is parsed and the script tag has finished loading.
setSignedIn(Boolean(state.token));
renderUser();
loadMe().then(() => loadInviteFromUrl());
