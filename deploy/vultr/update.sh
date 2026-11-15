#!/usr/bin/env bash
# Pull the latest code from GitHub and restart. Keys (/etc/mending/visit.env) and saved visits (/var/lib/mending)
# are not touched.   Run as root:  bash /opt/mending/deploy/vultr/update.sh
set -euo pipefail
APP=/opt/mending; BRANCH="${BRANCH:-main}"
git -C "$APP" fetch -q --depth 1 origin "$BRANCH"
git -C "$APP" reset -q --hard "origin/$BRANCH"
ln -sfn /etc/mending/visit.env "$APP/during-visit/backend/.env"
"$APP/venv/bin/pip" install -q -r "$APP/during-visit/backend/requirements.txt"
systemctl restart mending-visit
sleep 2
curl -fs http://127.0.0.1:8000/api/demo-scenarios >/dev/null && echo "Updated to $(git -C "$APP" log --oneline -1) and running." \
  || { echo "Not answering yet; see: journalctl -u mending-visit -n 50"; exit 1; }
