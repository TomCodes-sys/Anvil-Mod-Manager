#!/usr/bin/env bash
# Ore & Anvil — bootstrap
# Run this ONCE over SSH on the Ubuntu Server box that's running Crafty
# Controller. Installs Ore & Anvil into /opt/ore-and-anvil and starts it as a
# systemd service that comes back up automatically on every reboot.

set -e

echo "=================================================="
echo "  Ore & Anvil — bootstrap"
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

INSTALL_DIR="/opt/ore-and-anvil"

echo "[1/5] Installing prerequisites (python3, pip, venv)..."
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq python3 python3-venv python3-pip > /dev/null

echo "[2/5] Copying files to $INSTALL_DIR ..."
$SUDO mkdir -p "$INSTALL_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
$SUDO cp -r "$SCRIPT_DIR"/app.py "$SCRIPT_DIR"/templates "$SCRIPT_DIR"/static "$SCRIPT_DIR"/requirements.txt "$INSTALL_DIR"/
$SUDO mkdir -p "$INSTALL_DIR/data"
$SUDO chown -R "$INSTALL_USER":"$INSTALL_USER" "$INSTALL_DIR"

echo "[3/5] Setting up Python virtual environment..."
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install -q -r "$INSTALL_DIR/requirements.txt"

echo "[4/5] Installing the systemd service (runs as '$INSTALL_USER')..."
sed "s/__INSTALL_USER__/$INSTALL_USER/" "$SCRIPT_DIR/ore-and-anvil.service" | $SUDO tee /etc/systemd/system/ore-and-anvil.service > /dev/null
$SUDO systemctl daemon-reload
$SUDO systemctl enable ore-and-anvil > /dev/null 2>&1

echo "[5/5] Starting Ore & Anvil..."
$SUDO systemctl restart ore-and-anvil
sleep 2

IP=$(hostname -I | awk '{print $1}')

echo ""
echo "=================================================="
if $SUDO systemctl is-active --quiet ore-and-anvil; then
  echo "  Ore & Anvil is running, and will auto-start on every reboot."
  echo ""
  echo "  Open this on a browser on the SAME network:"
  echo ""
  echo "    http://$IP:5151/"
  echo ""
  echo "  It runs as the '$INSTALL_USER' user, so it can read/write into that"
  echo "  user's Crafty servers/<id>/ folders. If Crafty runs under a different"
  echo "  account, edit /etc/systemd/system/ore-and-anvil.service (the User="
  echo "  line), then: sudo systemctl daemon-reload && sudo systemctl restart ore-and-anvil"
else
  echo "  Something went wrong — the service didn't start. Check the logs with:"
  echo ""
  echo "    sudo journalctl -u ore-and-anvil -n 50 --no-pager"
fi
echo "=================================================="
