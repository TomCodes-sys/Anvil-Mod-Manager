const MOD_LOADERS = [
  { id: "fabric", label: "Fabric" },
  { id: "quilt", label: "Quilt" },
  { id: "forge", label: "Forge" },
  { id: "neoforge", label: "NeoForge" },
];
const PLUGIN_PLATFORMS = [
  { id: "paper", label: "Paper" },
  { id: "purpur", label: "Purpur" },
  { id: "spigot", label: "Spigot" },
  { id: "bukkit", label: "Bukkit" },
  { id: "folia", label: "Folia" },
];
const PAGE_SIZE = 20;

const state = {
  browsePath: null,
  selectedServer: null,     // full server data object
  searchType: "mod",        // mod | plugin | datapack
  searchSource: "modrinth",
  previewMode: false,
  selectedLoaders: new Set(),   // loader/platform filter checkboxes
  selectedVersions: new Set(),  // game version filter checkboxes
  allVersions: [],
  page: 1,
  totalResults: 0,
  lastCheckedResults: [],   // most recent /api/check_updates results, for changelog/update-all
};

function icons() { if (window.lucide) lucide.createIcons(); }

// ---------------- Preview mode ----------------
async function loadPreviewMode() {
  const res = await fetch("/api/settings/preview_mode");
  const data = await res.json();
  state.previewMode = data.preview_mode;
  document.getElementById("preview-toggle").checked = state.previewMode;
  document.getElementById("preview-banner").style.display = state.previewMode ? "flex" : "none";
}
async function setPreviewMode(enabled) {
  const res = await fetch("/api/settings/preview_mode", {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ enabled }),
  });
  const data = await res.json();
  state.previewMode = data.preview_mode;
  document.getElementById("preview-toggle").checked = state.previewMode;
  document.getElementById("preview-banner").style.display = state.previewMode ? "flex" : "none";
}
document.getElementById("preview-toggle").addEventListener("change", (e) => {
  setPreviewMode(e.target.checked);
  document.getElementById("preview-status").textContent = e.target.checked
    ? "On — installs/updates/removals are simulated."
    : "Off — actions will write to disk normally.";
});
document.getElementById("btn-exit-preview").addEventListener("click", () => {
  setPreviewMode(false);
  document.getElementById("preview-toggle").checked = false;
});
loadPreviewMode();

async function loadDemoServer() {
  const res = await fetch("/api/demo/seed", { method: "POST" });
  const data = await res.json();
  applySelectedServer(data);
  state.previewMode = true;
  document.getElementById("preview-toggle").checked = true;
  document.getElementById("preview-banner").style.display = "flex";
  document.getElementById("detect-hint").textContent = "Demo server loaded — no real folder needed. Head to Browse & Install.";
  document.getElementById("setup-status").textContent = `Preview Server ready on Minecraft ${data.mc_version} (${data.loader}). Nothing will be written to disk.`;
  loadSavedServers();
  return data;
}
document.getElementById("btn-load-demo").addEventListener("click", loadDemoServer);

// ---------------- Tabs ----------------
function moveTabIndicator(tabEl) {
  const indicator = document.getElementById("tab-indicator");
  if (!indicator || !tabEl) return;
  indicator.style.width = tabEl.offsetWidth + "px";
  indicator.style.transform = `translateX(${tabEl.offsetLeft - 4}px)`;
}

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
    moveTabIndicator(btn);
    if (btn.dataset.tab === "installed") refreshInstalled();
    if (btn.dataset.tab === "modpack") updateModpackServerLabel();
  });
});
window.addEventListener("load", () => moveTabIndicator(document.querySelector(".tab.active")));
window.addEventListener("resize", () => moveTabIndicator(document.querySelector(".tab.active")));

// ---------------- Directory browser ----------------
async function loadDir(path) {
  const res = await fetch("/api/browse" + (path ? `?path=${encodeURIComponent(path)}` : ""));
  const data = await res.json();
  if (data.error) { document.getElementById("dir-list").innerHTML = `<div class="dir-row">${data.error}</div>`; return; }
  state.browsePath = data.current;
  document.getElementById("path-input").value = data.current;
  const list = document.getElementById("dir-list");
  list.innerHTML = "";
  data.entries.forEach(e => {
    const row = document.createElement("div");
    row.className = "dir-row";
    row.textContent = e.name;
    row.addEventListener("click", () => loadDir(e.path));
    row.addEventListener("dblclick", () => selectServerFolder(e.path));
    list.appendChild(row);
  });
  document.getElementById("btn-select-server").disabled = false;
}
document.getElementById("btn-up").addEventListener("click", async () => {
  const res = await fetch(`/api/browse?path=${encodeURIComponent(state.browsePath)}`);
  const data = await res.json();
  loadDir(data.parent);
});
document.getElementById("btn-go").addEventListener("click", () => loadDir(document.getElementById("path-input").value));
document.getElementById("btn-select-server").addEventListener("click", () => selectServerFolder(state.browsePath));
loadDir(null);

async function selectServerFolder(path) {
  document.getElementById("path-input").value = path;
  state.browsePath = path;
  document.getElementById("server-name").value = path.split("/").filter(Boolean).pop();
  const res = await fetch(`/api/server/detect?path=${encodeURIComponent(path)}`);
  const info = await res.json();
  if (info.error) {
    document.getElementById("detect-hint").textContent = info.error;
    return;
  }
  document.getElementById("mc-version").value = info.mc_version || "";
  document.getElementById("loader-select").value = info.loader || "vanilla";
  document.getElementById("world-name").value = info.world_name || "world";
  document.getElementById("detect-hint").textContent = info.mc_version
    ? `Detected Minecraft ${info.mc_version}, loader/platform: ${info.loader}. Double-check before saving.`
    : `Couldn't auto-detect the version — please enter it manually.`;
}

document.getElementById("btn-save-config").addEventListener("click", async () => {
  const server_path = document.getElementById("path-input").value.trim();
  if (!server_path) return;
  const body = {
    server_path,
    name: document.getElementById("server-name").value || server_path,
    mc_version: document.getElementById("mc-version").value.trim(),
    loader: document.getElementById("loader-select").value,
    world_name: document.getElementById("world-name").value.trim() || "world",
  };
  const res = await fetch("/api/server/config", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) });
  const data = await res.json();
  applySelectedServer(data);
  document.getElementById("setup-status").textContent = `Saved. ${data.name} is now targeting Minecraft ${data.mc_version} (${data.loader}).`;
  loadSavedServers();
});

// Applies a server as the active one everywhere in the UI, persists it
// server-side so it's remembered next time the dashboard is opened, and
// refreshes the loader/platform filter checkboxes to match what that
// server actually supports.
function applySelectedServer(s) {
  state.selectedServer = s;
  document.getElementById("path-input").value = s.server_path;
  document.getElementById("server-name").value = s.name || "";
  document.getElementById("mc-version").value = s.mc_version || "";
  document.getElementById("loader-select").value = s.loader || "vanilla";
  document.getElementById("world-name").value = s.world_name || "world";
  document.getElementById("active-server-label").textContent = `${s.name} — MC ${s.mc_version} / ${s.loader}`;
  updateModpackServerLabel();
  fetch("/api/settings/active_server", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ server_path: s.server_path }),
  });
  // Auto-pick a sensible content type for this server: Bukkit-family
  // platforms browse plugins by default, everything else browses mods.
  const isPlugin = PLUGIN_PLATFORMS.some(p => p.id === s.loader);
  setSearchType(isPlugin ? "plugin" : "mod");
}

function updateModpackServerLabel() {
  const el = document.getElementById("modpack-server-label");
  if (!el) return;
  el.textContent = state.selectedServer ? (state.selectedServer.name || state.selectedServer.server_path) : "no server selected";
}

async function loadSavedServers() {
  const res = await fetch("/api/servers");
  const servers = await res.json();
  const row = document.getElementById("saved-servers");
  row.innerHTML = "";
  servers.forEach(s => {
    const chip = document.createElement("div");
    chip.className = "server-chip" + (state.selectedServer && state.selectedServer.server_path === s.server_path ? " active" : "");
    const name = document.createElement("span");
    name.className = "server-chip-name";
    name.textContent = s.name || s.server_path;
    const meta = document.createElement("span");
    meta.className = "server-chip-meta";
    meta.textContent = s.mc_version ? `MC ${s.mc_version} · ${s.loader || "vanilla"}` : "no version set";
    chip.appendChild(name);
    chip.appendChild(meta);
    chip.addEventListener("click", () => {
      applySelectedServer(s);
      loadSavedServers();
    });
    row.appendChild(chip);
  });
}

// On first load, auto-select whichever server was last active — so if
// you're managing several Crafty servers, the dashboard picks up right
// where you left off instead of making you re-select every visit.
async function restoreActiveServer() {
  const res = await fetch("/api/settings/active_server");
  const data = await res.json();
  if (data.server && data.server.mc_version) {
    applySelectedServer(data.server);
  }
  loadSavedServers();
}
restoreActiveServer();

// ---------------- Browse & install: content type / source toggles ----------------
function setSearchType(type) {
  state.searchType = type;
  state.page = 1;
  document.querySelectorAll("#type-toggle .seg").forEach(x => x.classList.toggle("active", x.dataset.type === type));
  renderLoaderFilterGroup();
  runSearch();
}
document.querySelectorAll("#type-toggle .seg").forEach(b => b.addEventListener("click", () => setSearchType(b.dataset.type)));

document.querySelectorAll("#source-toggle .seg").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll("#source-toggle .seg").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  state.searchSource = b.dataset.source;
  state.page = 1;
  runSearch();
}));

// ---------------- Loader / platform filter (sidebar) ----------------
function renderLoaderFilterGroup() {
  const group = document.getElementById("loader-filter-group");
  const title = document.getElementById("loader-filter-title");
  const container = document.getElementById("loader-checks");
  state.selectedLoaders.clear();

  if (state.searchType === "datapack") {
    group.style.display = "none";
    return;
  }
  group.style.display = "";
  const list = state.searchType === "plugin" ? PLUGIN_PLATFORMS : MOD_LOADERS;
  title.textContent = state.searchType === "plugin" ? "Platform" : "Loader";
  container.innerHTML = "";
  list.forEach(({ id, label }) => {
    const row = document.createElement("label");
    row.className = "filter-check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = id;
    // Pre-check the active server's own loader/platform so results default
    // to what will actually work on it.
    if (state.selectedServer && state.selectedServer.loader === id) {
      cb.checked = true;
      state.selectedLoaders.add(id);
      row.classList.add("active-label");
    }
    cb.addEventListener("change", () => {
      if (cb.checked) state.selectedLoaders.add(id); else state.selectedLoaders.delete(id);
      row.classList.toggle("active-label", cb.checked);
      state.page = 1;
      runSearch();
    });
    const span = document.createElement("span");
    span.textContent = label;
    row.appendChild(cb);
    row.appendChild(span);
    container.appendChild(row);
  });
}

// ---------------- Game version filter (sidebar) ----------------
async function loadGameVersions() {
  const res = await fetch("/api/game_versions");
  state.allVersions = await res.json();
  renderVersionChecks(state.allVersions);
}
function renderVersionChecks(versions) {
  const container = document.getElementById("version-checks");
  container.innerHTML = "";
  versions.slice(0, 60).forEach(v => {
    const row = document.createElement("label");
    row.className = "filter-check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = v;
    cb.checked = state.selectedVersions.has(v);
    if (cb.checked) row.classList.add("active-label");
    cb.addEventListener("change", () => {
      if (cb.checked) state.selectedVersions.add(v); else state.selectedVersions.delete(v);
      row.classList.toggle("active-label", cb.checked);
      state.page = 1;
      runSearch();
    });
    const span = document.createElement("span");
    span.textContent = v;
    row.appendChild(cb);
    row.appendChild(span);
    container.appendChild(row);
  });
}
document.getElementById("version-search-input").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  renderVersionChecks(q ? state.allVersions.filter(v => v.toLowerCase().includes(q)) : state.allVersions);
});
document.getElementById("version-filter-toggle").addEventListener("click", () => {
  document.getElementById("version-filter-toggle").closest(".filter-group").classList.toggle("collapsed");
});
loadGameVersions();

// ---------------- Search ----------------
document.getElementById("btn-search").addEventListener("click", () => { state.page = 1; runSearch(); });
document.getElementById("search-input").addEventListener("keydown", e => { if (e.key === "Enter") { state.page = 1; runSearch(); } });

// Live search as you type, Modrinth-style — debounced so it doesn't fire an
// API call on every keystroke.
let searchDebounce = null;
document.getElementById("search-input").addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => { state.page = 1; runSearch(); }, 400);
});

function showResultSkeletons(count = 6) {
  const grid = document.getElementById("results-grid");
  grid.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const card = document.createElement("div");
    card.className = "skeleton-card";
    card.innerHTML = `
      <div class="skeleton-block skeleton-icon"></div>
      <div class="skeleton-lines">
        <div class="skeleton-block"></div>
        <div class="skeleton-block"></div>
      </div>`;
    grid.appendChild(card);
  }
}

function addTag(container, text, extraClass, icon) {
  const tpl = document.getElementById("tpl-tag");
  const node = tpl.content.cloneNode(true);
  const chip = node.querySelector(".tag-chip");
  if (extraClass) chip.classList.add(extraClass);
  node.querySelector(".tag-icon").textContent = icon || "";
  node.querySelector(".tag-label").textContent = text;
  container.appendChild(node);
}

function renderResultTags(container, r) {
  container.innerHTML = "";
  // Every result on screen was already filtered to this version server-side —
  // shown here too so it's obvious at a glance without hovering anything.
  if (state.lastSearchedVersion) addTag(container, `MC ${state.lastSearchedVersion}`, "tag-version");
  // Environment: client / server / both — the same info Modrinth shows as
  // "Client or server", "Client", or "Server" pills.
  if (r.client_side && r.server_side) {
    const clientOn = r.client_side !== "unsupported";
    const serverOn = r.server_side !== "unsupported";
    let envText = "Client or server";
    if (clientOn && !serverOn) envText = "Client";
    else if (!clientOn && serverOn) envText = "Server";
    addTag(container, envText, "tag-env", "\u{1F5A5}");
  }
  // Loader / platform tags actually reported by Modrinth for this project.
  (r.loaders || []).forEach(l => addTag(container, l.charAt(0).toUpperCase() + l.slice(1), "tag-" + l));
  // Everything else Modrinth categorizes it under (Library, Optimization, ...).
  (r.categories || []).slice(0, 3).forEach(c => addTag(container, c.charAt(0).toUpperCase() + c.slice(1)));
}

async function runSearch() {
  const statusEl = document.getElementById("search-status");
  const grid = document.getElementById("results-grid");
  const pagination = document.getElementById("pagination");
  if (!state.selectedServer || !state.selectedServer.mc_version) {
    statusEl.textContent = "Select and save a server profile in Server Setup first.";
    statusEl.classList.add("error");
    grid.innerHTML = "";
    pagination.style.display = "none";
    return;
  }
  statusEl.classList.remove("error");
  statusEl.textContent = "Searching...";
  showResultSkeletons();
  const query = document.getElementById("search-input").value;
  // Selected version checkboxes narrow the search; with none checked, fall
  // back to the server's own configured version (the common case).
  const mcVersion = state.selectedVersions.size ? [...state.selectedVersions][0] : state.selectedServer.mc_version;
  const loaders = state.selectedLoaders.size ? [...state.selectedLoaders] : (state.selectedServer.loader && state.selectedServer.loader !== "vanilla" ? [state.selectedServer.loader] : []);
  state.lastSearchedVersion = mcVersion;
  const offset = (state.page - 1) * PAGE_SIZE;
  const params = new URLSearchParams({
    source: state.searchSource,
    query,
    type: state.searchType,
    mc_version: mcVersion,
    loaders: loaders.join(","),
    offset: String(offset),
  });
  const res = await fetch(`/api/search?${params}`);
  const data = await res.json();
  if (data.error) { grid.innerHTML = ""; statusEl.textContent = data.error; statusEl.classList.add("error"); pagination.style.display = "none"; return; }
  if (data.note) { grid.innerHTML = ""; statusEl.textContent = data.note; pagination.style.display = "none"; return; }
  state.totalResults = data.total || 0;
  const totalPages = Math.max(1, Math.ceil(state.totalResults / PAGE_SIZE));
  statusEl.textContent = `${data.total} result${data.total === 1 ? "" : "s"} for Minecraft ${mcVersion}` +
    (loaders.length ? ` / ${loaders.join(", ")}` : "") +
    (totalPages > 1 ? ` — page ${state.page} of ${totalPages}` : "");
  grid.innerHTML = "";
  const tpl = document.getElementById("tpl-result-card");
  data.results.forEach((r, i) => {
    const node = tpl.content.cloneNode(true);
    const card = node.querySelector(".result-card");
    card.style.setProperty("--stagger", `${Math.min(i, 10) * 35}ms`);
    const icon = node.querySelector(".result-icon");
    icon.src = r.icon_url || "";
    icon.alt = r.title;
    node.querySelector(".result-title").textContent = r.title;
    node.querySelector(".result-desc").textContent = r.description || "";
    node.querySelector(".result-author").textContent = r.author || "";
    node.querySelector(".result-downloads").textContent = r.downloads != null ? `${r.downloads.toLocaleString()} downloads` : "";
    renderResultTags(node.querySelector(".result-tags"), r);
    const btn = node.querySelector(".btn-install");
    btn.addEventListener("click", () => installItem(r, btn));
    grid.appendChild(node);
  });
  renderPagination(totalPages);
  icons();
}

function renderPagination(totalPages) {
  const pagination = document.getElementById("pagination");
  if (totalPages <= 1) { pagination.style.display = "none"; return; }
  pagination.style.display = "flex";
  document.getElementById("page-prev").disabled = state.page <= 1;
  document.getElementById("page-next").disabled = state.page >= totalPages;

  const numbers = document.getElementById("page-numbers");
  numbers.innerHTML = "";
  // Show up to 7 page buttons centered on the current page, Modrinth-style.
  let start = Math.max(1, state.page - 3);
  let end = Math.min(totalPages, start + 6);
  start = Math.max(1, end - 6);
  for (let p = start; p <= end; p++) {
    const btn = document.createElement("button");
    btn.className = "page-num" + (p === state.page ? " active" : "");
    btn.textContent = String(p);
    btn.addEventListener("click", () => { state.page = p; runSearch(); document.querySelector(".browse-main").scrollIntoView({ behavior: "smooth", block: "start" }); });
    numbers.appendChild(btn);
  }
}
document.getElementById("page-prev").addEventListener("click", () => { if (state.page > 1) { state.page--; runSearch(); } });
document.getElementById("page-next").addEventListener("click", () => { state.page++; runSearch(); });

async function installItem(r, btn) {
  btn.disabled = true;
  btn.textContent = "Installing...";
  const res = await fetch("/api/install", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      server_path: state.selectedServer.server_path,
      source: r.source, project_id: r.project_id, title: r.title, type: state.searchType,
      icon_url: r.icon_url,
    }),
  });
  const data = await res.json();
  if (data.error) {
    btn.textContent = "Failed";
    btn.title = data.error;
    setTimeout(() => { btn.disabled = false; btn.textContent = "Install"; }, 2200);
    return;
  }
  btn.textContent = data.preview ? "Simulated \u2713" : "Installed";
}

// ---------------- Installed / updates ----------------
async function refreshInstalled() {
  if (!state.selectedServer) return;
  document.getElementById("installed-server-label").textContent = state.selectedServer.name || state.selectedServer.server_path;
  document.getElementById("installed-mc-version").textContent = state.selectedServer.mc_version || "unset";
  document.getElementById("installed-loader").textContent = state.selectedServer.loader || "unset";
  const res = await fetch(`/api/installed?server_path=${encodeURIComponent(state.selectedServer.server_path)}`);
  const data = await res.json();
  renderInstalledList("installed-mods", data.mods);
  renderInstalledList("installed-plugins", data.plugins || []);
  renderInstalledList("installed-datapacks", data.datapacks);
  document.getElementById("btn-update-all").style.display = "none";
  icons();
}

function renderInstalledList(elId, items, statuses) {
  const el = document.getElementById(elId);
  el.innerHTML = "";
  if (!items.length) { el.innerHTML = `<p class="hint">Nothing installed yet.</p>`; return; }
  const tpl = document.getElementById("tpl-installed-row");
  items.forEach(item => {
    const node = tpl.content.cloneNode(true);
    const icon = node.querySelector(".installed-icon");
    icon.src = item.icon_url || "";
    icon.alt = item.title;
    icon.style.visibility = item.icon_url ? "visible" : "hidden";
    node.querySelector(".installed-title").textContent = item.title;
    node.querySelector(".installed-version").textContent = item.version_number || item.file_name;
    node.querySelector(".source-badge").textContent = item.source;
    if (item.preview) node.querySelector(".preview-badge").style.display = "inline-block";
    if (item.modpack) {
      const mb = node.querySelector(".modpack-badge");
      mb.style.display = "inline-block";
      mb.textContent = item.modpack;
      mb.title = `Imported from modpack: ${item.modpack}`;
    }
    const status = statuses ? statuses.find(s => s.project_id === item.project_id && s.source === item.source) : null;
    const pill = node.querySelector(".status-pill");
    const msg = node.querySelector(".status-message");
    const updateBtn = node.querySelector(".btn-update");
    const changelogBtn = node.querySelector(".btn-changelog");
    const conflictBadge = node.querySelector(".conflict-badge");
    if (status) {
      pill.classList.add(status.status);
      msg.textContent = status.message;
      if (status.conflicts && status.conflicts.length) {
        conflictBadge.style.display = "inline-flex";
        conflictBadge.title = `Known to conflict with: ${status.conflicts.join(", ")}`;
      }
      if (status.status === "update_available") {
        updateBtn.style.display = "inline-block";
        updateBtn.addEventListener("click", () => applyUpdate(item, updateBtn));
        changelogBtn.style.display = "inline-block";
        changelogBtn.addEventListener("click", () => openChangelog(item, status.latest, updateBtn));
      }
    } else {
      pill.classList.add("unknown");
      msg.textContent = `Targeting Minecraft ${item.mc_version}`;
    }
    if (item.last_backup) {
      const revertBtn = node.querySelector(".btn-revert");
      revertBtn.style.display = "inline-block";
      revertBtn.addEventListener("click", () => revertItem(item, revertBtn));
    }
    node.querySelector(".btn-uninstall").addEventListener("click", async (e) => {
      await fetch("/api/uninstall", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ server_path: state.selectedServer.server_path, source: item.source, project_id: item.project_id, type: item.type }),
      });
      refreshInstalled();
    });
    el.appendChild(node);
  });
  icons();
}

document.getElementById("btn-check-updates").addEventListener("click", async () => {
  const statusEl = document.getElementById("update-status");
  statusEl.textContent = "Checking every installed mod, plugin and datapack against the current server version...";
  const res = await fetch("/api/check_updates", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ server_path: state.selectedServer.server_path }),
  });
  const data = await res.json();
  state.lastCheckedResults = data.results;
  const mods = data.results.filter(r => r.type === "mod");
  const plugins = data.results.filter(r => r.type === "plugin");
  const datapacks = data.results.filter(r => r.type === "datapack");
  renderInstalledList("installed-mods", mods, data.results);
  renderInstalledList("installed-plugins", plugins, data.results);
  renderInstalledList("installed-datapacks", datapacks, data.results);
  const updates = data.results.filter(r => r.status === "update_available").length;
  const stuck = data.results.filter(r => r.status === "no_compatible_version").length;
  const conflicts = data.results.filter(r => r.conflicts && r.conflicts.length).length;
  statusEl.textContent = `${updates} update${updates === 1 ? "" : "s"} available. ` +
    (stuck ? `${stuck} item${stuck === 1 ? "" : "s"} have no build for Minecraft ${data.mc_version} yet. ` : "") +
    (conflicts ? `${conflicts} known conflict${conflicts === 1 ? "" : "s"} flagged.` : (stuck ? "" : "Everything else has a matching build."));
  document.getElementById("btn-update-all").style.display = updates > 0 ? "inline-flex" : "none";
});

document.getElementById("btn-update-all").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "Updating all...";
  const res = await fetch("/api/update_all", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ server_path: state.selectedServer.server_path }),
  });
  const data = await res.json();
  const statusEl = document.getElementById("update-status");
  statusEl.textContent = `Updated ${data.updated.length} item${data.updated.length === 1 ? "" : "s"}.` +
    (data.failed.length ? ` ${data.failed.length} failed.` : "");
  btn.disabled = false;
  btn.innerHTML = '<i data-lucide="download"></i>Update all';
  await refreshInstalled();
  document.getElementById("btn-check-updates").click();
});

document.getElementById("btn-restart-server").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.textContent = "Restarting...";
  try {
    const res = await fetch("/api/crafty/restart", { method: "POST" });
    const data = await res.json();
    document.getElementById("update-status").textContent = data.ok
      ? (data.preview ? "Restart simulated (preview mode)." : "Restart triggered through Crafty.")
      : (data.error || "Restart failed.");
  } catch (e2) {
    document.getElementById("update-status").textContent = "Couldn't reach the dashboard to trigger a restart.";
  }
  btn.disabled = false;
  btn.innerHTML = original;
  icons();
});

async function applyUpdate(item, btn) {
  btn.disabled = true;
  btn.textContent = "Updating...";
  await fetch("/api/update_mod", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ server_path: state.selectedServer.server_path, source: item.source, project_id: item.project_id, type: item.type }),
  });
  refreshInstalled();
}

async function revertItem(item, btn) {
  btn.disabled = true;
  btn.textContent = "Reverting...";
  const res = await fetch("/api/revert", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ server_path: state.selectedServer.server_path, source: item.source, project_id: item.project_id, type: item.type }),
  });
  const data = await res.json();
  if (data.error) { btn.textContent = "Failed"; btn.title = data.error; return; }
  refreshInstalled();
}

// ---------------- Changelog preview modal ----------------
let pendingChangelogUpdate = null;
function openChangelog(item, latest, updateBtn) {
  const modal = document.getElementById("changelog-modal");
  document.getElementById("changelog-title").textContent = `${item.title} — changelog`;
  document.getElementById("changelog-body").textContent = "Loading...";
  modal.style.display = "flex";
  pendingChangelogUpdate = { item, updateBtn };
  const params = new URLSearchParams({ source: item.source, project_id: item.project_id, version_id: latest.version_id });
  fetch(`/api/changelog?${params}`).then(r => r.json()).then(data => {
    document.getElementById("changelog-body").textContent = data.changelog || "No changelog was provided for this version.";
  }).catch(() => {
    document.getElementById("changelog-body").textContent = "Couldn't load the changelog.";
  });
}
function closeChangelogModal() {
  document.getElementById("changelog-modal").style.display = "none";
  pendingChangelogUpdate = null;
}
document.getElementById("changelog-close").addEventListener("click", closeChangelogModal);
document.getElementById("changelog-cancel").addEventListener("click", closeChangelogModal);
document.getElementById("changelog-modal").addEventListener("click", (e) => { if (e.target.id === "changelog-modal") closeChangelogModal(); });
document.getElementById("changelog-confirm-update").addEventListener("click", () => {
  if (!pendingChangelogUpdate) return;
  const { item, updateBtn } = pendingChangelogUpdate;
  closeChangelogModal();
  applyUpdate(item, updateBtn);
});

// ---------------- Modpack import / export ----------------
document.getElementById("btn-modpack-import").addEventListener("click", async () => {
  const statusEl = document.getElementById("modpack-import-status");
  const resultsEl = document.getElementById("modpack-import-results");
  resultsEl.innerHTML = "";
  if (!state.selectedServer) { statusEl.textContent = "Select a server in Server Setup first."; statusEl.classList.add("error"); return; }
  const url = document.getElementById("modpack-url").value.trim();
  const fileInput = document.getElementById("modpack-file");
  const file = fileInput.files[0];
  if (!url && !file) { statusEl.textContent = "Paste a modpack URL or choose a .mrpack file."; statusEl.classList.add("error"); return; }

  statusEl.classList.remove("error");
  statusEl.textContent = "Importing — downloading and installing every server-compatible mod...";

  const form = new FormData();
  form.append("server_path", state.selectedServer.server_path);
  if (url) form.append("url", url);
  if (file) form.append("file", file);

  try {
    const res = await fetch("/api/modpack/import", { method: "POST", body: form });
    const data = await res.json();
    if (data.error) { statusEl.textContent = data.error; statusEl.classList.add("error"); return; }
    statusEl.textContent = `Imported "${data.modpack_name || "modpack"}" — ${data.installed.length} installed` +
      (data.skipped.length ? `, ${data.skipped.length} skipped.` : ".") +
      (data.preview ? " (preview mode — simulated)" : "");
    if (data.skipped.length) {
      resultsEl.innerHTML = "<p class='hint'>Skipped: " + data.skipped.map(s => `${s.file} (${s.reason})`).join(", ") + "</p>";
    }
    document.getElementById("modpack-url").value = "";
    fileInput.value = "";
  } catch (e) {
    statusEl.textContent = "Import failed — check the URL/file and try again.";
    statusEl.classList.add("error");
  }
});

document.getElementById("btn-modpack-export").addEventListener("click", () => {
  if (!state.selectedServer) { alert("Select a server in Server Setup first."); return; }
  const params = new URLSearchParams({ server_path: state.selectedServer.server_path });
  window.location.href = `/api/modpack/export?${params}`;
});

// ---------------- Settings: CurseForge key ----------------
(async function loadKey() {
  const res = await fetch("/api/settings/curseforge_key");
  const data = await res.json();
  document.getElementById("cf-key").value = data.key || "";
})();
document.getElementById("btn-save-key").addEventListener("click", async () => {
  const key = document.getElementById("cf-key").value.trim();
  await fetch("/api/settings/curseforge_key", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ key }) });
  document.getElementById("settings-status").textContent = "Saved.";
});

// ---------------- Settings: Crafty API ----------------
(async function loadCraftySettings() {
  const res = await fetch("/api/settings/crafty");
  const data = await res.json();
  document.getElementById("crafty-url").value = data.url || "";
  document.getElementById("crafty-server-id").value = data.server_id || "";
  document.getElementById("crafty-token").placeholder = data.token_set ? "(saved — leave blank to keep)" : "paste token here";
})();
document.getElementById("btn-save-crafty").addEventListener("click", async () => {
  const url = document.getElementById("crafty-url").value.trim();
  const token = document.getElementById("crafty-token").value.trim();
  const server_id = document.getElementById("crafty-server-id").value.trim();
  const body = { url, server_id };
  if (token) body.token = token;
  await fetch("/api/settings/crafty", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) });
  document.getElementById("crafty-settings-status").textContent = "Saved.";
  document.getElementById("crafty-token").value = "";
});

// ---------------- Self-update check (GitHub) ----------------
async function checkSelfUpdate() {
  try {
    const res = await fetch("/api/self_update_check");
    const data = await res.json();
    const banner = document.getElementById("update-banner");
    if (data.update_available) {
      document.getElementById("update-banner-text").textContent =
        `Update available for Anvil Mod Manager: ${data.current} → ${data.latest} — "${data.latest_message || ""}"`;
      document.getElementById("update-banner-link").href = data.compare_url;
      banner.style.display = "flex";
    } else {
      banner.style.display = "none";
    }
  } catch (e) { /* ignore — GitHub might be unreachable */ }
}
async function applySelfUpdate() {
  const btn = document.getElementById("update-banner-btn");
  btn.disabled = true;
  btn.textContent = "Updating...";
  try {
    const res = await fetch("/api/self_update", { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      btn.textContent = "Restarting service...";
      setTimeout(() => location.reload(), 4000);
    } else {
      btn.disabled = false;
      btn.textContent = "Update now";
      alert(data.error || "Update failed.");
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Update now";
  }
}
checkSelfUpdate();

// ---------------- Auto-preview (launched via "Preview Demo" shortcut) ----------------
(async function autoPreviewBootstrap() {
  const params = new URLSearchParams(location.search);
  if (params.get("autopreview") !== "1") return;
  await loadDemoServer();
  document.querySelector('.tab[data-tab="browse"]').click();
  document.getElementById("search-input").value = "sodium";
  runSearch();
})();

renderLoaderFilterGroup();
icons();
