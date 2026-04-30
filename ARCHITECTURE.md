# DA Task Alert - Architecture

This document maps every source file in the project.

---

## Overview

DA Task Alert monitors the DataAnnotation projects page for new paid projects and sends push notifications via ntfy.sh. It comes in three forms: a Tampermonkey userscript (browser), a Python CLI monitor (local/server), and a systemd service (Oracle Cloud).

```
userscript/                Browser-based monitoring (Tampermonkey)
local/                     Python CLI monitor
server/                    Oracle Cloud deployment guide + systemd unit
shared/                    Configuration template
```

---

## How It Works

```
DataAnnotation projects page
         |
         v
  Read `data-props` JSON from the hybrid root div
  (legacy `<h2>Projects</h2>` table fallback)
         |
         v
  Filter: exclude refreshers, match keywords
         |
         v
  Compare against seen_projects list
         |
         v
  New projects found?
    |            |
    No           Yes
    |              |
    v              v
  Sleep        POST to ntfy.sh + desktop notification
  (5min+)        (each channel toggleable via PHONE_NOTIFY /
                 DESKTOP_NOTIFY)
                 |
                 v
              Add to seen_projects (cap at 500)
```

---

## File Reference

### Userscript (Recommended)

**userscript/da-task-alert.user.js**
- Tampermonkey/Greasemonkey compatible (with `@downloadURL` / `@updateURL` for auto-update)
- Reads the `data-props` JSON blob off DA's hybrid root div, with a legacy table fallback
- Polls every 300s+ (configurable, minimum 5 minutes)
- Persists seen project IDs to GM_storage (max 500)
- Keyword inclusion/exclusion filtering
- Push notifications via ntfy.sh POST (toggleable via the panel)
- Desktop notifications via GM_notification (toggleable via the panel)
- Floating settings panel (bottom-right on any DA page); handles the tab-based DA layout + empty state
- Registers Tampermonkey menu command

### Python Monitor

**local/monitor.py**
- Fetches DA projects page via session cookie
- Parses the `data-props` JSON blob off the hybrid root div (BeautifulSoup); falls back to the legacy table scraper if the hybrid root is missing
- Keyword filtering (include/exclude)
- ntfy.sh POST with priority/tags (toggleable via `PHONE_NOTIFY`)
- Desktop notifications via plyer (toggleable via `DESKTOP_NOTIFY`)
- Persistent seen_projects.json (max 500)
- `--once` mode for cron, daemon mode for continuous
- Detects session cookie expiry (redirects to login)

**local/requirements.txt**
- requests, beautifulsoup4, python-dotenv, plyer

### Server Deployment

**server/da-task-alert.service** - systemd unit file
**server/README.md** (~79 lines) - Oracle Cloud VM setup guide

### Configuration

**shared/config.example.env**
- NTFY_TOPIC (required)
- POLL_INTERVAL (default: 300s)
- DA_SESSION_COOKIE (Python only)
- KEYWORDS / EXCLUDE_KEYWORDS
- PHONE_NOTIFY / DESKTOP_NOTIFY flags (each channel toggleable independently)
