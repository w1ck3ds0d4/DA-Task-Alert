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
  Scrape project table (DOM or HTTP)
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
  (5min+)        |
                 v
              Add to seen_projects (cap at 500)
```

---

## File Reference

### Userscript (Recommended)

**userscript/da-task-alert.user.js** (~693 lines)
- Tampermonkey/Greasemonkey compatible
- Scrapes live DOM for project table
- Polls every 300s+ (configurable, minimum 5 minutes)
- Persists seen project IDs to GM_storage (max 500)
- Keyword inclusion/exclusion filtering
- Push notifications via ntfy.sh POST
- Desktop notifications via GM_notification
- Floating settings panel (bottom-right on DA pages)
- Registers Tampermonkey menu command

### Python Monitor

**local/monitor.py** (~341 lines)
- Fetches DA projects page via session cookie
- BeautifulSoup HTML parsing
- Keyword filtering (include/exclude)
- ntfy.sh POST with priority/tags
- Desktop notifications via plyer
- Persistent seen_projects.json (max 500)
- `--once` mode for cron, daemon mode for continuous
- Detects session cookie expiry (redirects to login)

**local/requirements.txt**
- requests, beautifulsoup4, python-dotenv, plyer

### Server Deployment

**server/da-task-alert.service** - systemd unit file
**server/README.md** (~79 lines) - Oracle Cloud VM setup guide

### Configuration

**shared/config.example.env** (~21 lines)
- NTFY_TOPIC (required)
- POLL_INTERVAL (default: 300s)
- DA_SESSION_COOKIE (Python only)
- KEYWORDS / EXCLUDE_KEYWORDS
- DESKTOP_NOTIFY flag
