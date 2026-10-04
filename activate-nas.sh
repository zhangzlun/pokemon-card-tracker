#!/bin/sh
# Run once on Synology as root after enabling Tailscale Serve/HTTPS.
set -eu
if [ "$(id -u)" -ne 0 ]; then
  echo '請在 NAS 以 sudo 執行此檔案。' >&2
  exit 1
fi
cd /volume1/docker/pokemon-card-tracker
/usr/local/bin/docker compose up -d --build
/var/packages/Tailscale/target/bin/tailscale serve --bg http://127.0.0.1:5174
/var/packages/Tailscale/target/bin/tailscale serve status
