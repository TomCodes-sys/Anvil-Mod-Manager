# Ore & Anvil — Mod Manager for Crafty Controller

A small local dashboard that sits next to [Crafty Controller](https://craftycontrol.com/) and handles the part Crafty doesn't:
finding, installing, and updating mods and datapacks for a specific server, from **Modrinth** and **CurseForge**.

It only ever shows you files built for the Minecraft version (and mod loader) your server is *currently* running.
When you bump the server to a new Minecraft version, it re-checks every installed mod/datapack and either updates it
automatically or warns you that no build exists yet for the new version — it will never silently install something
incompatible.

## Features

- **Server Setup** — point it at the folder Crafty runs a server from. It auto-detects the Minecraft version (read
  from `version.json` inside the server jar), the loader/platform (Fabric / Quilt / Forge / NeoForge for modded
  servers, Paper / Purpur / Spigot / Bukkit / Folia for plugin servers, or vanilla, detected from installed
  libraries and jar names), and the world folder name (read from `server.properties`). You can override any of it.
- **Browse & Install** — search Modrinth or CurseForge for mods, Modrinth for plugins, or Modrinth for datapacks.
  A sidebar lets you filter by loader/platform (Fabric, Forge, NeoForge, Quilt, or Paper, Purpur, Spigot, Bukkit,
  Folia) and by Minecraft version, on top of the server-side filtering to your saved server's version. Results show
  small tag chips for the Minecraft version, client/server/both compatibility, and loader/platform — the same
  at-a-glance info Modrinth's own site shows.
- **Installed** — see everything you've installed through the tool, grouped by mods / plugins / datapacks, each with
  its icon, exact version installed, and source.
- **Check for Updates** — re-queries both APIs for every installed item against your server's *current* configured
  version. Each item gets one of three states:
  - `Up to date`
  - `Update available` (one click to fetch and swap the file)
  - `No compatible version found yet` — a clear warning, nothing is touched
- Multiple saved server profiles — manage more than one Crafty server from the same dashboard. Whichever server you
  last worked on is remembered and auto-selected the next time you open the dashboard.
- **Preview mode** — a toggle (Settings tab) that lets you try the whole flow with zero risk: search still hits the
  real Modrinth/CurseForge APIs, but install/update/remove are simulated instead of touching your disk. The
  **"Load demo server"** button on the Server Setup tab seeds a fake `Preview Server` (Minecraft 1.20.1 / Fabric)
  and flips preview mode on automatically, so you can go straight to Browse & Install with no real folder needed.
  Items installed while previewing are tagged `preview` in the Installed tab and are always simulated on
  update/remove too, even if you later turn the toggle off.

## Requirements

- Python 3.9+
- Runs on the same machine as Crafty (it reads/writes directly into your server folders, the same way Crafty itself
  does) — or anywhere with filesystem access to your Crafty `servers/<id>/` directories, e.g. over a mounted volume.
- A free [CurseForge API key](https://console.curseforge.com/) if you want CurseForge search (Modrinth needs no key).
  CurseForge search covers mods only — datapacks are Modrinth-only, since CurseForge's API doesn't expose that
  content type in a reliable way.

## Setup

### Windows (easiest)

No terminal needed. Two double-clickable launchers are included at the top of the folder:

- **`Start Preview Demo.bat`** — sets everything up on first run, then opens your browser straight into a live
  demo: a fake "Preview Server" on Minecraft 1.20.1 / Fabric, preview mode already on, and a search for "sodium"
  already run. Click around, install things — nothing touches your disk. Best first thing to try.
- **`Start Ore and Anvil.bat`** — normal startup. Sets up a Python virtual environment the first time (takes a
  minute), then every time after that just launches the app and opens your browser to it.

Both require [Python 3.9+](https://www.python.org/downloads/) installed with **"Add python.exe to PATH"** checked
during setup — the script will tell you if it's missing. Each launcher opens a console window that's running the
server; close that window to stop it.

### Ubuntu Server (recommended — runs alongside Crafty as a background service)

SSH into the same Ubuntu Server box that's running Crafty Controller, then:

```bash
git clone https://github.com/<you>/ore-and-anvil.git
cd ore-and-anvil
chmod +x bootstrap.sh
./bootstrap.sh
```

This installs Python, sets up a virtual environment, and starts Ore & Anvil as a systemd service
(`ore-and-anvil`) that comes back up automatically on every reboot — no need to run `python app.py` by hand or
keep an SSH session open. At the end it prints the link to open:

```
Open this on a browser on the SAME network:

  http://192.168.1.50:5151/
```

The service runs as whatever user ran `bootstrap.sh`, so it can read/write your Crafty `servers/<id>/mods`
folders the same way Crafty itself does. If Crafty runs under a different system account, edit the `User=` line
in `/etc/systemd/system/ore-and-anvil.service`, then `sudo systemctl daemon-reload && sudo systemctl restart
ore-and-anvil`.

Useful commands afterward:

```bash
sudo systemctl status ore-and-anvil     # is it running?
sudo journalctl -u ore-and-anvil -f     # live logs
sudo systemctl restart ore-and-anvil    # after a git pull / update
```

### macOS / Linux / manual setup

```bash
git clone https://github.com/<you>/ore-and-anvil.git
cd ore-and-anvil
pip install -r requirements.txt
python app.py
```

Then open **http://localhost:5151** (or the machine's IP if you're running this on your server box and browsing
from elsewhere).

Set `PORT=xxxx` as an environment variable if 5151 is already taken.

## Using it

1. **Server Setup tab** — browse to your Crafty server's folder (this is the folder containing `server.jar`,
   `mods/`, and your world folder — usually something like
   `/var/opt/minecraft/crafty/servers/<server-id>/` on a standard Crafty install, but wherever Crafty put it on your
   system). Double-click the folder to select it, confirm the detected version/loader, and save.
2. **Browse & Install tab** — search and install. Files land straight in `mods/` or `<world>/datapacks/`, exactly
   where Crafty expects them.
3. After you update your server's Minecraft version (new server jar via Crafty, or a Fabric/Forge loader bump), go
   back to **Server Setup**, update the Minecraft version field, and save.
4. **Installed tab** → **Check for updates**. Anything with a matching build downloads automatically when you click
   Update; anything without one is flagged so you know exactly what's blocking you before you restart the server.

## Notes on data storage

Everything the tool tracks (which mods/datapacks you installed through it, and their source/version IDs) lives in
`data/server_<hash>.json` per server, plus `data/settings.json` for your CurseForge key and the list of saved
servers. Nothing is sent anywhere except Modrinth's and CurseForge's public APIs — there's no telemetry.

If you manually drop a jar into `mods/` outside this tool, it won't show up in the Installed tab (the tool only
tracks what it installed itself) — install it through the dashboard instead so update-checking can find it later.

## Limitations

- CurseForge's search API is mods-only here; browse datapacks on Modrinth.
- Version auto-detection reads `version.json` from the jars in the server root. Some very old server jars or heavily
  customized installers don't include this — in that case just type the version in manually.
- This tool doesn't restart or manage the server process itself — that's still Crafty's job. Restart the server
  through Crafty after installing or updating mods.
