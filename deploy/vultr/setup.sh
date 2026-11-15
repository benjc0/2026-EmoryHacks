#!/usr/bin/env bash
# Mending: set up the Visit Copilot server on a fresh Vultr Ubuntu 24.04 server. Run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/benjc0/2026-EmoryHacks/main/deploy/vultr/setup.sh | bash
#
# What it does: installs Python + Caddy, downloads the repo to /opt/mending, runs the FastAPI server as a
# background service (restarts on crash/reboot), and serves it at https://visit.mending.fit with an automatic
# HTTPS certificate (needed for the microphone). Safe to run again; it never overwrites your keys.
set -euo pipefail

DOMAIN="${DOMAIN:-visit.mending.fit}"        # the GoDaddy "visit" A record must point at this server
SITE="${SITE:-https://mending.fit}"          # the dashboard on Vercel
REPO="${REPO:-https://github.com/benjc0/2026-EmoryHacks.git}"
BRANCH="${BRANCH:-main}"
APP=/opt/mending
DATA=/var/lib/mending                        # saved visits live here, outside the code, so updates never touch them
ENVFILE=/etc/mending/visit.env               # keys live here (only root + the service can read it)

[ "$(id -u)" = 0 ] || { echo "Please run as root (or with sudo)."; exit 1; }
export DEBIAN_FRONTEND=noninteractive
say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

say "Installing system packages"
apt-get update -y -q
apt-get install -y -q git python3 python3-venv python3-pip curl ufw gnupg debian-keyring debian-archive-keyring apt-transport-https
if ! command -v caddy >/dev/null 2>&1; then
  if curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
     && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list; then
    apt-get update -y -q
  fi
  apt-get install -y -q caddy             # official repo if reachable, otherwise Ubuntu's own caddy package
fi

say "Downloading the app to $APP"
id mending >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin mending
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch -q --depth 1 origin "$BRANCH" && git -C "$APP" reset -q --hard "origin/$BRANCH"
else
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$APP"
fi

say "Installing Python packages"
python3 -m venv "$APP/venv"
"$APP/venv/bin/pip" install -q --upgrade pip
"$APP/venv/bin/pip" install -q -r "$APP/during-visit/backend/requirements.txt"

say "Settings and data folders"
mkdir -p "$DATA" /etc/mending
chown mending:mending "$DATA"
if [ ! -f "$ENVFILE" ]; then
  cp "$APP/during-visit/backend/.env.example" "$ENVFILE"
  # server-specific values (the keys are left empty for you to fill in)
  sed -i -E "s|^#? *DATA_DIR=.*|DATA_DIR=$DATA|; s|^PT_APP_DIR=.*|PT_APP_DIR=|; s|^#? *ALLOW_RESET=.*|ALLOW_RESET=true|" "$ENVFILE"
  cat >> "$ENVFILE" <<CONF

# ---- Hosting (written by deploy/vultr/setup.sh) ----
# "Start home exercises" at the end of a visit opens the dashboard on Vercel
PT_APP_URL=$SITE/
# Browsers on these sites may call this server
CORS_ORIGINS=$SITE,${SITE/https:\/\//https://www.},https://$DOMAIN
CONF
  NEW_ENV=1
fi
chown mending:mending "$ENVFILE"; chmod 600 "$ENVFILE"
ln -sfn "$ENVFILE" "$APP/during-visit/backend/.env"        # config.py reads backend/.env

say "Background service"
cat > /etc/systemd/system/mending-visit.service <<UNIT
[Unit]
Description=Mending Visit Copilot (FastAPI)
After=network-online.target
Wants=network-online.target

[Service]
User=mending
WorkingDirectory=$APP/during-visit/backend
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=$APP/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --proxy-headers --forwarded-allow-ips=127.0.0.1
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable -q mending-visit
systemctl restart mending-visit

say "HTTPS (Caddy) for $DOMAIN"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:8000
}
CADDY
systemctl enable -q caddy
systemctl restart caddy

say "Firewall: allow SSH, HTTP, HTTPS"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null

say "Checking"
sleep 3
if curl -fs http://127.0.0.1:8000/api/demo-scenarios >/dev/null; then echo "  app is running"; else echo "  app did not answer yet: journalctl -u mending-visit -n 50"; fi
MYIP=$(hostname -I | awk '{print $1}')
DNSIP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
if [ "$DNSIP" = "$MYIP" ]; then echo "  DNS ok: $DOMAIN -> $MYIP"
else echo "  DNS: $DOMAIN points to '${DNSIP:-nothing yet}', this server is $MYIP. Add/fix the GoDaddy A record (name: visit, value: $MYIP); Caddy gets the certificate automatically once it points here."; fi

cat <<NEXT

Done. Next:
$( [ "${NEW_ENV:-}" = 1 ] && echo "  1. Add your keys:   nano $ENVFILE      (GEMINI_API_KEY, TYPESENSE_HOST, TYPESENSE_API_KEY)" || echo "  1. Keys file kept as it was: $ENVFILE" )
  2. Apply them:       systemctl restart mending-visit
  3. Typesense (once): cd $APP/during-visit/backend && sudo -u mending $APP/venv/bin/python search_index.py setup
  4. Open:             https://$DOMAIN/          (logs: journalctl -u mending-visit -f)
  Update later:        bash $APP/deploy/vultr/update.sh
NEXT
