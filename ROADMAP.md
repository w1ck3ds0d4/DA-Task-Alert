# DA Task Alert - Roadmap

**Type**: Monitoring tool for DataAnnotation projects
**Stack**: Python (CLI), JavaScript (Tampermonkey userscript)
**Notifications**: ntfy.sh push, desktop

---

## Legend
- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete

---

## Phase 1 - Core Monitoring
> Goal: detect new paid projects and send alerts

- [x] Tampermonkey userscript with live DOM scraping
- [x] Python CLI monitor with session cookie auth
- [x] ntfy.sh push notifications
- [x] Desktop notifications (GM_notification / plyer)
- [x] Keyword inclusion and exclusion filtering
- [x] Refresher/Reference Version auto-filtering
- [x] Seen project tracking (max 500, persistent)
- [x] Configurable poll interval (5-minute minimum)
- [x] Session cookie expiry detection

## Phase 2 - Deployment
> Goal: run headlessly on a server

- [x] Oracle Cloud free-tier deployment guide
- [x] systemd service unit file
- [x] Environment variable configuration
- [x] --once mode for cron scheduling

## Phase 3 - Improvements
> Goal: more notification channels and reliability

- [ ] Slack webhook integration
- [ ] Discord webhook integration
- [ ] Email notifications (SMTP)
- [ ] Project detail scraping (description, requirements)
- [ ] Historical project database (SQLite)
- [ ] Rate/pay trend tracking over time
- [ ] Proxy/VPN support for Python monitor
- [ ] Auto cookie refresh (headless browser login)

## Phase 4 - Dashboard
> Goal: web UI for monitoring and history

- [ ] Simple web dashboard (Flask/FastAPI)
- [ ] Project history timeline
- [ ] Earnings estimate tracker
- [ ] Filter presets (save keyword sets)
- [ ] Multi-account support
