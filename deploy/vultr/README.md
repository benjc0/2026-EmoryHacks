# Hosting Visit Copilot on Vultr (visit.mending.fit)

```
https://mending.fit          -> Vercel   (after-visit: dashboard + PT exercise pages)        unchanged
https://visit.mending.fit    -> Vultr    (during-visit: Visit Copilot app + API, search, saved visits)
```

The dashboard on mending.fit talks to `https://visit.mending.fit` automatically
(`after-visit/js/visitConnection.js`, `HOSTED_SERVER`). On localhost everything works as before.

## 1. Create the server (Vultr)
Deploy → Cloud Compute (Shared CPU) → location **Atlanta** → image **Ubuntu 24.04 LTS x64** → the smallest
plan (1 GB) is enough → Deploy. Copy its **IPv4 address**.

## 2. Point the subdomain at it (GoDaddy)
Domain **mending.fit** → DNS → **Add New Record**: Type **A**, Name **visit**, Value **the server's IPv4**,
TTL 600 seconds. Leave every existing record (the ones for Vercel) alone.

## 3. Install (on the server, as root: Vultr's "View Console" or `ssh root@IP`)
```bash
curl -fsSL https://raw.githubusercontent.com/benjc0/2026-EmoryHacks/main/deploy/vultr/setup.sh | bash
nano /etc/mending/visit.env            # GEMINI_API_KEY, TYPESENSE_HOST, TYPESENSE_API_KEY (Admin key)
systemctl restart mending-visit
cd /opt/mending/during-visit/backend && sudo -u mending /opt/mending/venv/bin/python search_index.py setup
```
Open https://visit.mending.fit/ (the HTTPS certificate appears within a minute once the DNS record points here).

## Day to day
| | |
|---|---|
| Update to the latest GitHub code | `bash /opt/mending/deploy/vultr/update.sh` |
| Live logs | `journalctl -u mending-visit -f` |
| Restart | `systemctl restart mending-visit` |
| Keys / settings | `/etc/mending/visit.env` (never in git) |
| Saved visits | `/var/lib/mending` (kept across updates) |
| Wipe demo data | `cd /opt/mending/during-visit/backend && sudo -u mending /opt/mending/venv/bin/python reset_demo.py --all` |
