"""
Crafty Mod Manager
A companion dashboard for Crafty Controller servers that lets you search,
install, and update mods (Modrinth / CurseForge) and datapacks (Modrinth),
scoped to whatever Minecraft version + loader your server is currently on.
"""
import hashlib
import json
import os
import re
import zipfile
from pathlib import Path

import requests
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder="static", template_folder="templates")

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
SETTINGS_FILE = DATA_DIR / "settings.json"

MODRINTH_API = "https://api.modrinth.com/v2"
CURSEFORGE_API = "https://api.curseforge.com/v1"
CF_MINECRAFT_GAME_ID = 432
CF_MODS_CLASS_ID = 6

LOADER_MARKERS = {
    "fabric": ["fabric-server-launch.jar", "libraries/net/fabricmc", ".fabric-installer"],
    "quilt": ["quilt-server-launch.jar", "libraries/org/quiltmc"],
    "forge": ["libraries/net/minecraftforge", "run.sh", "forge-installer"],
    "neoforge": ["libraries/net/neoforged"],
    "paper": ["libraries/io/papermc/paper"],
    "purpur": ["purpur.jar", "libraries/org/purpurmc"],
    "spigot": ["spigot.jar", "libraries/org/spigotmc"],
    "folia": ["libraries/io/papermc/folia"],
    "bukkit": ["craftbukkit.jar"],
}

# Loaders that install .jar mods into mods/ (Fabric-family + Forge-family).
MOD_LOADERS = {"fabric", "quilt", "forge", "neoforge"}
# Platforms that install .jar plugins into plugins/ (Bukkit-family).
PLUGIN_PLATFORMS = {"paper", "purpur", "spigot", "bukkit", "folia"}

HEADERS_UA = {"User-Agent": "crafty-mod-manager/1.0 (github project)"}


# --------------------------------------------------------------------------
# Settings (CurseForge API key, saved server profiles)
# --------------------------------------------------------------------------
def load_settings():
    if SETTINGS_FILE.exists():
        data = json.loads(SETTINGS_FILE.read_text())
        data.setdefault("preview_mode", False)
        return data
    return {"curseforge_api_key": "", "servers": {}, "preview_mode": False}


DEMO_SERVER_PATH = "demo://preview-server"


def save_settings(settings):
    SETTINGS_FILE.write_text(json.dumps(settings, indent=2))


def server_key(path):
    return hashlib.sha1(path.encode()).hexdigest()[:12]


def server_data_file(path):
    return DATA_DIR / f"server_{server_key(path)}.json"


def load_server_data(path):
    f = server_data_file(path)
    if f.exists():
        data = json.loads(f.read_text())
        data.setdefault("plugins", [])
        return data
    return {"server_path": path, "mc_version": "", "loader": "vanilla",
            "world_name": "world", "mods": [], "datapacks": [], "plugins": []}


def save_server_data(path, data):
    server_data_file(path).write_text(json.dumps(data, indent=2))


# --------------------------------------------------------------------------
# Filesystem helpers (browsing the Crafty install on this machine)
# --------------------------------------------------------------------------
@app.route("/api/browse")
def browse():
    path = request.args.get("path") or str(Path.home())
    p = Path(path)
    if not p.exists() or not p.is_dir():
        return jsonify({"error": "Path not found or not a directory"}), 400
    entries = []
    try:
        for child in sorted(p.iterdir(), key=lambda x: x.name.lower()):
            if child.is_dir() and not child.name.startswith("."):
                entries.append({"name": child.name, "path": str(child)})
    except PermissionError:
        return jsonify({"error": "Permission denied"}), 403
    return jsonify({"current": str(p), "parent": str(p.parent), "entries": entries})


def detect_loader(server_path: Path):
    for loader, markers in LOADER_MARKERS.items():
        for marker in markers:
            if (server_path / marker).exists():
                return loader
    # fallback: scan root for jar names
    for jar in server_path.glob("*.jar"):
        name = jar.name.lower()
        if "fabric" in name:
            return "fabric"
        if "quilt" in name:
            return "quilt"
        if "forge" in name and "neoforge" not in name:
            return "forge"
        if "neoforge" in name:
            return "neoforge"
        if "purpur" in name:
            return "purpur"
        if "paper" in name:
            return "paper"
        if "spigot" in name:
            return "spigot"
        if "craftbukkit" in name or "bukkit" in name:
            return "bukkit"
        if "folia" in name:
            return "folia"
    return "vanilla"


def detect_mc_version(server_path: Path):
    # Try every jar in the root; vanilla/modded server jars often embed version.json
    for jar in server_path.glob("*.jar"):
        try:
            with zipfile.ZipFile(jar) as z:
                if "version.json" in z.namelist():
                    info = json.loads(z.read("version.json"))
                    if info.get("id"):
                        return info["id"]
        except (zipfile.BadZipFile, KeyError):
            continue
    # Fabric/Quilt/Forge installers sometimes leave a clue in a log or properties file
    for name in ("server.properties",):
        f = server_path / name
        if f.exists():
            text = f.read_text(errors="ignore")
            m = re.search(r"level-seed|motd", text)  # no reliable version field here
    return ""


def detect_world_name(server_path: Path):
    props = server_path / "server.properties"
    if props.exists():
        for line in props.read_text(errors="ignore").splitlines():
            if line.startswith("level-name="):
                val = line.split("=", 1)[1].strip()
                return val or "world"
    return "world"


@app.route("/api/server/detect")
def api_detect():
    path = request.args.get("path", "")
    p = Path(path)
    if not p.exists():
        return jsonify({"error": "Path not found"}), 400
    return jsonify({
        "mc_version": detect_mc_version(p),
        "loader": detect_loader(p),
        "world_name": detect_world_name(p),
        "has_mods_folder": (p / "mods").exists(),
    })


@app.route("/api/server/config", methods=["GET", "POST"])
def api_server_config():
    if request.method == "POST":
        body = request.json
        path = body["server_path"]
        data = load_server_data(path)
        data.update({
            "server_path": path,
            "mc_version": body.get("mc_version", data["mc_version"]),
            "loader": body.get("loader", data["loader"]),
            "world_name": body.get("world_name", data.get("world_name", "world")),
            "name": body.get("name", data.get("name", Path(path).name)),
        })
        save_server_data(path, data)
        settings = load_settings()
        settings["servers"][server_key(path)] = {"path": path, "name": data["name"]}
        save_settings(settings)
        return jsonify(data)
    else:
        path = request.args.get("path", "")
        return jsonify(load_server_data(path))


@app.route("/api/servers")
def api_servers():
    settings = load_settings()
    out = []
    for key, meta in settings.get("servers", {}).items():
        d = load_server_data(meta["path"])
        out.append(d)
    return jsonify(out)


@app.route("/api/settings/active_server", methods=["GET", "POST"])
def active_server():
    """Remembers which server was last selected so it's auto-selected again
    next time the dashboard is opened — handy when you manage more than one
    Crafty server and don't want to re-pick every visit."""
    settings = load_settings()
    if request.method == "POST":
        settings["active_server"] = request.json.get("server_path", "")
        save_settings(settings)
        return jsonify({"ok": True})
    path = settings.get("active_server", "")
    return jsonify({"server_path": path, "server": load_server_data(path) if path else None})


# --------------------------------------------------------------------------
# Settings: CurseForge key
# --------------------------------------------------------------------------
@app.route("/api/settings/curseforge_key", methods=["GET", "POST"])
def cf_key():
    settings = load_settings()
    if request.method == "POST":
        settings["curseforge_api_key"] = request.json.get("key", "")
        save_settings(settings)
        return jsonify({"ok": True})
    return jsonify({"key": settings.get("curseforge_api_key", "")})


@app.route("/api/settings/preview_mode", methods=["GET", "POST"])
def preview_mode_setting():
    settings = load_settings()
    if request.method == "POST":
        settings["preview_mode"] = bool(request.json.get("enabled", False))
        save_settings(settings)
        return jsonify({"ok": True, "preview_mode": settings["preview_mode"]})
    return jsonify({"preview_mode": settings.get("preview_mode", False)})


@app.route("/api/demo/seed", methods=["POST"])
def demo_seed():
    """Create a fake server profile so search/install can be tried with no real
    Crafty folder. Always installs in preview (simulated) mode regardless of
    the global toggle, since there is no real folder to write into."""
    settings = load_settings()
    settings["preview_mode"] = True
    data = load_server_data(DEMO_SERVER_PATH)
    data.update({
        "server_path": DEMO_SERVER_PATH,
        "name": "Preview Server",
        "mc_version": "1.20.1",
        "loader": "fabric",
        "world_name": "world",
    })
    save_server_data(DEMO_SERVER_PATH, data)
    settings["servers"][server_key(DEMO_SERVER_PATH)] = {"path": DEMO_SERVER_PATH, "name": data["name"]}
    save_settings(settings)
    return jsonify(data)


# --------------------------------------------------------------------------
# Search
# --------------------------------------------------------------------------
@app.route("/api/search")
def api_search():
    source = request.args.get("source", "modrinth")
    query = request.args.get("query", "")
    content_type = request.args.get("type", "mod")  # mod | datapack | plugin
    mc_version = request.args.get("mc_version", "")
    # Comma-separated so the sidebar can multi-select (e.g. "fabric,quilt").
    loaders = [l for l in request.args.get("loaders", "").split(",") if l]
    offset = int(request.args.get("offset", 0))

    if source == "modrinth":
        return jsonify(search_modrinth(query, content_type, mc_version, loaders, offset))
    elif source == "curseforge":
        if content_type != "mod":
            return jsonify({"results": [], "total": 0,
                             "note": f"CurseForge search here only covers mods; use Modrinth for {content_type}s."})
        return jsonify(search_curseforge(query, mc_version, loaders[0] if loaders else "", offset))
    return jsonify({"error": "unknown source"}), 400


@app.route("/api/game_versions")
def api_game_versions():
    """Minecraft versions for the sidebar filter, straight from Modrinth's
    tag list. Releases only unless ?all=1 is passed (snapshots/betas)."""
    show_all = request.args.get("all") == "1"
    r = requests.get(f"{MODRINTH_API}/tag/game_version", headers=HEADERS_UA, timeout=20)
    r.raise_for_status()
    versions = r.json()
    if not show_all:
        versions = [v for v in versions if v.get("version_type") == "release"]
    return jsonify([v["version"] for v in versions])


def search_modrinth(query, content_type, mc_version, loaders, offset):
    project_type = "plugin" if content_type == "plugin" else content_type
    facets = [[f"project_type:{project_type}"]]
    if mc_version:
        facets.append([f"versions:{mc_version}"])
    if content_type in ("mod", "plugin") and loaders:
        # OR within the group: any one of the selected loaders/platforms matches.
        facets.append([f"categories:{l}" for l in loaders])
    params = {
        "query": query,
        "limit": 20,
        "offset": offset,
        "facets": json.dumps(facets),
    }
    r = requests.get(f"{MODRINTH_API}/search", params=params, headers=HEADERS_UA, timeout=20)
    r.raise_for_status()
    data = r.json()
    results = [{
        "source": "modrinth",
        "project_id": h["project_id"],
        "slug": h["slug"],
        "title": h["title"],
        "description": h["description"],
        "icon_url": h.get("icon_url"),
        "downloads": h.get("downloads"),
        "author": h.get("author"),
        "categories": [c for c in h.get("categories", []) if c not in PLUGIN_PLATFORMS | MOD_LOADERS],
        "loaders": [c for c in h.get("categories", []) if c in PLUGIN_PLATFORMS | MOD_LOADERS] or h.get("display_categories", []),
        "client_side": h.get("client_side"),   # required | optional | unsupported
        "server_side": h.get("server_side"),
        "versions": h.get("versions", []),
    } for h in data.get("hits", [])]
    return {"results": results, "total": data.get("total_hits", 0)}


def search_curseforge(query, mc_version, loader, offset):
    settings = load_settings()
    key = settings.get("curseforge_api_key")
    if not key:
        return {"results": [], "total": 0, "error": "No CurseForge API key set. Add one in Settings."}
    headers = {"x-api-key": key, **HEADERS_UA}
    params = {
        "gameId": CF_MINECRAFT_GAME_ID,
        "classId": CF_MODS_CLASS_ID,
        "searchFilter": query,
        "index": offset,
        "pageSize": 20,
        "sortField": 2,
        "sortOrder": "desc",
    }
    if mc_version:
        params["gameVersion"] = mc_version
    loader_map = {"forge": 1, "fabric": 4, "quilt": 5, "neoforge": 6}
    if loader in loader_map:
        params["modLoaderType"] = loader_map[loader]
    r = requests.get(f"{CURSEFORGE_API}/mods/search", params=params, headers=headers, timeout=20)
    if r.status_code == 401:
        return {"results": [], "total": 0, "error": "CurseForge rejected the API key."}
    r.raise_for_status()
    data = r.json()
    results = [{
        "source": "curseforge",
        "project_id": str(m["id"]),
        "slug": m.get("slug"),
        "title": m.get("name"),
        "description": m.get("summary"),
        "icon_url": (m.get("logo") or {}).get("thumbnailUrl"),
        "downloads": m.get("downloadCount"),
        "author": (m.get("authors") or [{}])[0].get("name"),
        "categories": [],
    } for m in data.get("data", [])]
    return {"results": results, "total": data.get("pagination", {}).get("totalCount", 0)}


# --------------------------------------------------------------------------
# Version lookup + install + update-check
# --------------------------------------------------------------------------
def modrinth_best_version(project_id, mc_version, loader, content_type):
    params = {"game_versions": json.dumps([mc_version])}
    if content_type in ("mod", "plugin") and loader and loader != "vanilla":
        params["loaders"] = json.dumps([loader])
    r = requests.get(f"{MODRINTH_API}/project/{project_id}/version", params=params,
                      headers=HEADERS_UA, timeout=20)
    r.raise_for_status()
    versions = r.json()
    if not versions:
        return None
    versions.sort(key=lambda v: v.get("date_published", ""), reverse=True)
    v = versions[0]
    primary_file = next((f for f in v["files"] if f.get("primary")), v["files"][0])
    return {
        "version_id": v["id"],
        "version_number": v.get("version_number"),
        "file_name": primary_file["filename"],
        "download_url": primary_file["url"],
    }


def curseforge_best_version(project_id, mc_version, loader):
    settings = load_settings()
    key = settings.get("curseforge_api_key")
    if not key:
        return None
    headers = {"x-api-key": key, **HEADERS_UA}
    params = {"gameVersion": mc_version}
    loader_map = {"forge": 1, "fabric": 4, "quilt": 5, "neoforge": 6}
    if loader in loader_map:
        params["modLoaderType"] = loader_map[loader]
    r = requests.get(f"{CURSEFORGE_API}/mods/{project_id}/files", params=params,
                      headers=headers, timeout=20)
    if r.status_code != 200:
        return None
    files = r.json().get("data", [])
    if not files:
        return None
    files.sort(key=lambda f: f.get("fileDate", ""), reverse=True)
    f = files[0]
    return {
        "version_id": str(f["id"]),
        "version_number": f.get("displayName"),
        "file_name": f["fileName"],
        "download_url": f.get("downloadUrl"),
    }


def resolve_version(source, project_id, mc_version, loader, content_type):
    if source == "modrinth":
        return modrinth_best_version(project_id, mc_version, loader, content_type)
    else:
        return curseforge_best_version(project_id, mc_version, loader)


def is_preview(server_path, settings=None):
    settings = settings or load_settings()
    return bool(settings.get("preview_mode")) or server_path == DEMO_SERVER_PATH


def bucket_for(content_type):
    """Which list in the server's data file a piece of content lives in."""
    return {"mod": "mods", "plugin": "plugins", "datapack": "datapacks"}[content_type]


def dest_dir_for(server_path, data, content_type):
    """Where a downloaded file actually gets written on disk, matching what
    Crafty/the server itself expects to find."""
    if content_type == "mod":
        return Path(server_path) / "mods"
    elif content_type == "plugin":
        return Path(server_path) / "plugins"
    else:  # datapack
        return Path(server_path) / data.get("world_name", "world") / "datapacks"


@app.route("/api/install", methods=["POST"])
def api_install():
    body = request.json
    server_path = body["server_path"]
    source = body["source"]
    project_id = body["project_id"]
    title = body.get("title", project_id)
    content_type = body.get("type", "mod")  # mod | datapack | plugin
    icon_url = body.get("icon_url")

    data = load_server_data(server_path)
    mc_version, loader = data["mc_version"], data["loader"]
    if not mc_version:
        return jsonify({"error": "Set the server's Minecraft version first (Server Setup tab)."}), 400

    # Real lookup against Modrinth/CurseForge either way, so results are accurate
    # even in preview mode.
    version = resolve_version(source, project_id, mc_version, loader, content_type)
    if not version or not version.get("download_url"):
        return jsonify({"error": f"No {source} file found for {title} on Minecraft {mc_version}"
                                  f"{' / ' + loader if content_type in ('mod', 'plugin') else ''}."}), 404

    preview = is_preview(server_path)
    if not preview:
        dest_dir = dest_dir_for(server_path, data, content_type)
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_file = dest_dir / version["file_name"]
        r = requests.get(version["download_url"], headers=HEADERS_UA, timeout=60)
        r.raise_for_status()
        dest_file.write_bytes(r.content)

    entry = {
        "project_id": project_id,
        "source": source,
        "title": title,
        "icon_url": icon_url,
        "version_id": version["version_id"],
        "version_number": version.get("version_number"),
        "file_name": version["file_name"],
        "mc_version": mc_version,
        "loader": loader if content_type in ("mod", "plugin") else "datapack",
        "type": content_type,
        "preview": preview,
    }
    bucket = bucket_for(content_type)
    data[bucket] = [m for m in data[bucket] if m["project_id"] != project_id or m["source"] != source]
    data[bucket].append(entry)
    save_server_data(server_path, data)
    return jsonify({"ok": True, "installed": entry, "preview": preview})


@app.route("/api/installed")
def api_installed():
    path = request.args.get("server_path", "")
    data = load_server_data(path)
    return jsonify({"mods": data["mods"], "datapacks": data["datapacks"],
        "plugins": data.get("plugins", []),
                     "mc_version": data["mc_version"], "loader": data["loader"]})


@app.route("/api/check_updates", methods=["POST"])
def api_check_updates():
    body = request.json
    server_path = body["server_path"]
    data = load_server_data(server_path)
    mc_version, loader = data["mc_version"], data["loader"]
    results = []
    for bucket in ("mods", "plugins", "datapacks"):
        for item in data[bucket]:
            latest = resolve_version(item["source"], item["project_id"], mc_version,
                                      loader if item["type"] in ("mod", "plugin") else "", item["type"])
            if latest is None:
                status = "no_compatible_version"
                message = (f"No {item['source']} build of {item['title']} is available yet "
                            f"for Minecraft {mc_version}. Keeping the currently installed file.")
            elif latest["version_id"] != item["version_id"]:
                status = "update_available"
                message = f"Update available: {item.get('version_number', item['file_name'])} -> " \
                           f"{latest.get('version_number', latest['file_name'])}"
            else:
                status = "up_to_date"
                message = "Up to date."
            results.append({**item, "status": status, "message": message,
                             "latest": latest})
    return jsonify({"results": results, "mc_version": mc_version, "loader": loader})


@app.route("/api/update_mod", methods=["POST"])
def api_update_mod():
    body = request.json
    server_path = body["server_path"]
    source = body["source"]
    project_id = body["project_id"]
    content_type = body.get("type", "mod")

    data = load_server_data(server_path)
    mc_version, loader = data["mc_version"], data["loader"]
    bucket = bucket_for(content_type)
    item = next((m for m in data[bucket] if m["project_id"] == project_id and m["source"] == source), None)
    if not item:
        return jsonify({"error": "Not installed"}), 404

    latest = resolve_version(source, project_id, mc_version, loader if content_type in ("mod", "plugin") else "", content_type)
    if not latest:
        return jsonify({"error": "No compatible version found for the current Minecraft version."}), 404

    if not item.get("preview"):
        dest_dir = dest_dir_for(server_path, data, content_type)
        old_file = dest_dir / item["file_name"]
        if old_file.exists():
            old_file.unlink()
        r = requests.get(latest["download_url"], headers=HEADERS_UA, timeout=60)
        r.raise_for_status()
        (dest_dir / latest["file_name"]).write_bytes(r.content)

    item.update({
        "version_id": latest["version_id"],
        "version_number": latest.get("version_number"),
        "file_name": latest["file_name"],
        "mc_version": mc_version,
    })
    save_server_data(server_path, data)
    return jsonify({"ok": True, "updated": item})


@app.route("/api/uninstall", methods=["POST"])
def api_uninstall():
    body = request.json
    server_path = body["server_path"]
    source = body["source"]
    project_id = body["project_id"]
    content_type = body.get("type", "mod")

    data = load_server_data(server_path)
    bucket = bucket_for(content_type)
    item = next((m for m in data[bucket] if m["project_id"] == project_id and m["source"] == source), None)
    if item:
        if not item.get("preview"):
            dest_dir = dest_dir_for(server_path, data, content_type)
            f = dest_dir / item["file_name"]
            if f.exists():
                f.unlink()
        data[bucket] = [m for m in data[bucket] if not (m["project_id"] == project_id and m["source"] == source)]
        save_server_data(server_path, data)
    return jsonify({"ok": True})


# --------------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory("templates", "index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5151))
    # ORE_ANVIL_DEBUG=1 for local dev (auto-reload). Off by default so it's
    # safe to run under systemd (bootstrap.sh sets nothing, so this is off
    # on a real server install).
    debug = os.environ.get("ORE_ANVIL_DEBUG", "0") == "1"
    if not debug:
        print("=" * 50)
        print("  Ore & Anvil is running.")
        print(f"  Open this in a browser: http://<this-machine-ip>:{port}/")
        print("=" * 50)
    app.run(host="0.0.0.0", port=port, debug=debug)
