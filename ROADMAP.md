# DA Task Alert, Roadmap

This document captures planned work, known gaps, and what the project does
not currently do. It is intentionally conservative: items here are
candidates, not commitments.

## Status Legend

- `[x]` Complete and shipping.
- `[~]` In progress on `main`.
- `[ ]` Not started.

## Phase 1, Core Monitoring (shipping)

Goal: detect new paid projects and deliver alerts.

- [x] Tampermonkey userscript with live DOM scraping
  (`userscript/da-task-alert.user.js`).
- [x] Python CLI monitor with session cookie auth
  (`local/monitor.py`).
- [x] ntfy.sh push notifications, both forms.
- [x] Desktop notifications (`GM_notification` + `plyer`).
- [x] Keyword include and exclude filtering.
- [x] Auto-filter Refreshers and Reference Versions (unpaid training).
- [x] Persistent seen-projects set, capped at 500 entries.
- [x] Configurable poll interval with a 5 minute floor.
- [x] Python session-cookie expiry detection plus urgent ntfy alert.

## Phase 2, Deployment (shipping)

Goal: run headlessly on a server.

- [x] Oracle Cloud free-tier deployment guide
  (`server/README.md`).
- [x] Hardened systemd unit (`server/da-task-alert.service`).
- [x] Environment-variable based config (`shared/config.example.env`).
- [x] `--once` mode for cron scheduling.

## Phase 3, Improvements (planned)

Goal: more notification channels and operational reliability.

- [ ] Slack webhook integration.
- [ ] Discord webhook integration.
- [ ] Email notifications (SMTP).
- [ ] Project detail scraping (description, requirements). Currently
  only the name, pay, task count, and created timestamp are captured.
- [ ] Historical project database (SQLite). Today, state is just a
  flat seen-set in `local/seen_projects.json`.
- [ ] Pay-rate trend tracking over time.
- [ ] Proxy / VPN support for the Python monitor.
- [ ] Auto cookie refresh via headless browser login. Today, expired
  cookies require manual replacement and a service restart.

## Phase 4, Dashboard (speculative)

Goal: web UI for monitoring and history.

- [ ] Simple web dashboard (Flask or FastAPI).
- [ ] Project history timeline.
- [ ] Earnings estimate tracker.
- [ ] Filter presets (save named keyword sets).
- [ ] Multi-account support.

## Known Gaps

- No automated tests. Both the userscript and the Python monitor are
  validated by hand against the live DA dashboard.
- No CI pipeline. Releases are manual edits to the userscript version
  header and a fresh Python pull on the server.
- No structured logging. Both forms write plaintext to stdout / browser
  console.
- The legacy `<table>` fallback in `local/monitor.py` and the userscript
  exists for forward compatibility but is no longer exercised by DA's
  current dashboard. It has not been re-tested recently.
- Server deployment guide assumes Ubuntu and Oracle Cloud's Always Free
  shape. No instructions exist for other providers, but nothing in the
  service file is Oracle-specific.
- ntfy is the only push backend. There is no abstraction layer for
  other push providers (yet, see Phase 3).

## Out of Scope

The following are intentionally not pursued:

- Hosted / SaaS deployment of the monitor. Users self-host.
- Bypassing DA's authentication. The tool always uses the user's own
  session cookie or live browser session.
- Automated task acceptance or click-through. The tool only notifies.
- Polling faster than 5 minutes. The floor is enforced in code as a
  safety measure against account flagging.

## Release Process

Releases are tag-driven and manual. There is no automation for bumping
the userscript `@version` header or pushing a new `.user.js` to the
auto-update URL. When the format ever changes, this section will grow.
