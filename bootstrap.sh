#!/usr/bin/env bash
# Anvil Mod Manager — bootstrap
# Run this ONCE over SSH on the Ubuntu Server box that's running Crafty
# Controller. Installs Anvil Mod Manager into /opt/anvil-mod-manager and starts it as a
# systemd service that comes back up automatically on every reboot.

set -e

echo "=================================================="
echo "  Anvil Mod Manager — bootstrap"
echo "=================================================="

if [ "$EUID" -eq 0 ]; then
  SUDO=""
  INSTALL_USER="root"
else
  if ! command -v sudo &> /dev/null; then
    echo "This user isn't root and sudo isn't installed, so this script can't get the"
    echo "admin privileges it needs. Either:"
    echo "  1) Log in as root (or 'su -') and re-run this script, or"
    echo "  2) As root, run: apt install sudo   then add yourself: usermod -aG sudo $(whoami)"
    echo "     log out and back in, and re-run this script."
    exit 1
  fi
  if ! sudo -v; then
    echo ""
    echo "This user ($(whoami)) doesn't have sudo privileges, so the install can't continue."
    echo "Add it with: usermod -aG sudo $(whoami)   (as root), then log out/in and retry."
    exit 1
  fi
  SUDO="sudo"
  INSTALL_USER="$(whoami)"
fi

INSTALL_DIR="/opt/anvil-mod-manager"

echo "[1/5] Installing prerequisites (python3, pip, venv, git)..."
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq python3 python3-venv python3-pip git > /dev/null

echo "[2/5] Copying files to $INSTALL_DIR ..."
$SUDO mkdir -p "$INSTALL_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Copies the whole checkout (including .git, if present) so the built-in
# "check for updates" banner can later run `git pull` from $INSTALL_DIR.
$SUDO cp -r "$SCRIPT_DIR"/. "$INSTALL_DIR"/
$SUDO rm -rf "$INSTALL_DIR/.venv" "$INSTALL_DIR/venv"
$SUDO mkdir -p "$INSTALL_DIR/data"
$SUDO chown -R "$INSTALL_USER":"$INSTALL_USER" "$INSTALL_DIR"

echo "[3/5] Setting up Python virtual environment..."
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install -q -r "$INSTALL_DIR/requirements.txt"

echo "[4/5] Installing the systemd service (runs as '$INSTALL_USER')..."
sed "s/__INSTALL_USER__/$INSTALL_USER/" "$SCRIPT_DIR/anvil-mod-manager.service" | $SUDO tee /etc/systemd/system/anvil-mod-manager.service > /dev/null
$SUDO systemctl daemon-reload
$SUDO systemctl enable anvil-mod-manager > /dev/null 2>&1

# The app itself runs as "$INSTALL_USER" (not root) so it only has the same
# filesystem access as Crafty — but the "Update now" button needs to restart
# its own systemd unit afterward. Rather than running the whole app as root
# for that one action, grant a narrow, single-command sudo exception. We
# resolve the real systemctl path here (rather than hardcoding /bin or
# /usr/bin) since sudo's secure_path must match exactly what it resolves to,
# and that differs across Ubuntu versions/setups.
if [ "$INSTALL_USER" != "root" ]; then
  SYSTEMCTL_PATH="$(command -v systemctl)"
  echo "$INSTALL_USER ALL=(root) NOPASSWD: $SYSTEMCTL_PATH restart anvil-mod-manager" | \
    $SUDO tee /etc/sudoers.d/anvil-mod-manager-restart > /dev/null
  $SUDO chmod 440 /etc/sudoers.d/anvil-mod-manager-restart
  $SUDO visudo -c -f /etc/sudoers.d/anvil-mod-manager-restart > /dev/null || \
    echo "  WARNING: the generated sudoers rule failed validation — 'Update now' may not be able to restart the service. Check /etc/sudoers.d/anvil-mod-manager-restart"
fi

echo "[5/5] Starting Anvil Mod Manager..."
$SUDO systemctl restart anvil-mod-manager
sleep 2

IP=$(hostname -I | awk '{print $1}')

echo ""
echo "=================================================="
if $SUDO systemctl is-active --quiet anvil-mod-manager; then
  echo "  Anvil Mod Manager is running, and will auto-start on every reboot."
  echo ""
  echo "  Open this on a browser on the SAME network:"
  echo ""
  echo "    http://$IP:5151/"
  echo ""
  echo "  It runs as the '$INSTALL_USER' user, so it can read/write into that"
  echo "  user's Crafty servers/<id>/ folders. If Crafty runs under a different"
  echo "  account, edit /etc/systemd/system/anvil-mod-manager.service (the User="
  echo "  line), then: sudo systemctl daemon-reload && sudo systemctl restart anvil-mod-manager"
else
  echo "  Something went wrong — the service didn't start. Check the logs with:"
  echo ""
  echo "    sudo journalctl -u anvil-mod-manager -n 50 --no-pager"
fi
echo "=================================================="
