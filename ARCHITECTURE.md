# DA Task Alert, Architecture

This document describes the system architecture, tech stack, components, and
data flow of DA Task Alert.

## Overview

DA Task Alert is a small, multi-form monitoring tool for the DataAnnotation
worker dashboard at `https://app.dataannotation.tech/workers/projects`. It
detects new paid projects and dispatches alerts over two channels: ntfy.sh
push (phone) and OS desktop notifications. The project ships in three
delivery forms that share the same scrape and filter logic:

1. A Tampermonkey userscript (browser).
2. A Python CLI monitor (local machine).
3. A systemd service (Oracle Cloud free-tier VM).

## Tech Stack

- Python 3 (CLI monitor).
- JavaScript (Tampermonkey/Greasemonkey userscript).
- ntfy.sh (public, topic-based push relay).
- BeautifulSoup4 + requests (Python HTML fetch and parse).
- plyer (cross-platform desktop notifications).
- systemd (server-side daemonization).

See `local/requirements.txt` for the pinned Python dependencies.

## Repository Layout

```
DA-Task-Alert/
  userscript/
    da-task-alert.user.js      Tampermonkey userscript, full UI
  local/
    monitor.py                 Python CLI monitor
    requirements.txt           Python dependencies
  server/
    da-task-alert.service      systemd unit (hardened)
    README.md                  Oracle Cloud deployment guide
  shared/
    config.example.env         Configuration template (.env format)
  README.md                    Top-level user guide
  COMMERCIAL.md, LICENSE       Dual licensing (AGPL v3 + commercial)
```

## Components

### Userscript (`userscript/da-task-alert.user.js`)

A self-contained Tampermonkey script that runs on `app.dataannotation.tech/workers/*`.
It scrapes the live DOM of the projects page, persists state in
`GM_setValue` / `GM_getValue`, and renders a floating settings panel
(bottom-right). Notifications go out via `GM_xmlhttpRequest` to ntfy.sh
(restricted by the `@connect ntfy.sh` directive) and via `GM_notification`
for desktop. Auto-update is supported through the `@downloadURL` and
`@updateURL` headers.

### Python Monitor (`local/monitor.py`)

A single-file CLI app. It fetches the projects page using a session cookie
read from `.env`, parses the response, filters, compares against a
persisted seen-projects set in `local/seen_projects.json` (capped at 500),
and dispatches alerts. Two run modes: `--once` (cron-friendly) and the
default daemon loop (`while True: sleep(POLL_INTERVAL)`).

### Server Deployment (`server/`)

A systemd unit (`da-task-alert.service`) runs the Python monitor as the
`ubuntu` user out of `/opt/da-task-alert/local`. The unit is hardened with
`NoNewPrivileges=true`, `ProtectSystem=strict`, `ReadWritePaths` scoped
to the install directory, and `PrivateTmp=true`. Setup is documented in
`server/README.md`.

### Shared Config (`shared/config.example.env`)

A template `.env` consumed by the Python monitor. Same key names as the
userscript settings panel, so users can swap delivery forms without
relearning the knobs.

## Data Flow

```
DataAnnotation projects page  (HTML, React-rendered)
        |
        v
  Read `data-props` JSON from the hybrid root div
  (id `workers/WorkerProjectsTable-hybrid-root`)
  Falls back to legacy <table> scrape if the hybrid root is missing
        |
        v
  Build {name, id, pay, tasks, created} per project,
  drop entries listed in `hiddenProjects`
        |
        v
  Filter: drop empty `pay`, drop EXCLUDE_KEYWORDS,
  optionally require KEYWORDS match
        |
        v
  Diff against persisted seen set
  (userscript: GM_setValue;  python: local/seen_projects.json)
        |
        v
  For each new project, emit alerts:
    PHONE_NOTIFY  -> POST https://ntfy.sh/<NTFY_TOPIC>
    DESKTOP_NOTIFY -> GM_notification or plyer
        |
        v
  Persist updated seen set, prune to last 500 entries
```

## Key Invariants

- Poll interval is clamped to a 300 second minimum in both the Python
  monitor (`max(300, int(...))` in `local/monitor.py`) and the userscript
  defaults (`pollInterval: 300` in `userscript/da-task-alert.user.js`).
- Only paid projects (non-empty `pay` field) are alertable.
- Seen-projects storage is capped at 500 entries to avoid unbounded growth.
- ntfy topic names are sanitized to `[A-Za-z0-9_-]` before any HTTP call.
- The Python monitor detects session expiry by checking for `login` /
  `sign_in` in the redirect URL and emits a high-priority alert.

## Failure Modes

- DA layout change: if the hybrid root div disappears, the parser falls
  back to the legacy table scraper. If both fail, zero projects are
  returned and the user sees a "could not find projects data" log.
- Expired session cookie (Python only): the monitor sends an "urgent"
  ntfy alert and a desktop notification, then keeps polling. The cookie
  must be refreshed manually.
- Network errors: caught and logged. The next tick retries.
