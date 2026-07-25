#!/usr/bin/env bash
# Runs ON the WHC server (piped in over SSH by the deploy workflow).
# Swaps in the freshly-built standalone bundle with rollback on failure.
# The app's environment lives OUTSIDE the bundle at /root/jechemine.env
# and is loaded by systemd via: node --env-file=/root/jechemine.env /root/app/server.js
set -euo pipefail

BUNDLE=/root/deploy.tar.gz
APP=/root/app
PREV=/root/app-prev
NEW=/root/app-new

echo "[activate] extracting new bundle"
rm -rf "$NEW"; mkdir -p "$NEW"
tar -xzf "$BUNDLE" -C "$NEW"

echo "[activate] swapping in new release"
rm -rf "$PREV"
[ -d "$APP" ] && mv "$APP" "$PREV" || true
mv "$NEW" "$APP"

echo "[activate] restarting service"
systemctl restart jechemine
sleep 6

if systemctl is-active --quiet jechemine && curl -sf -o /dev/null --max-time 20 http://127.0.0.1:3000/; then
  echo "[activate] SUCCESS — jechemine active and responding"
  rm -f "$BUNDLE"
  rm -rf "$PREV"
else
  echo "[activate] FAILED — rolling back to previous release"
  rm -rf "$APP"
  [ -d "$PREV" ] && mv "$PREV" "$APP" || true
  systemctl restart jechemine
  exit 1
fi
