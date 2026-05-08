# How DA Task Alert Works

A user-facing guide to what the tool does, the key features, and how to
use it day to day. For deeper internals, see `ARCHITECTURE.md`.

## What It Does

DA Task Alert watches the DataAnnotation projects page
(`https://app.dataannotation.tech/workers/projects`) for new paid
projects and pushes a notification to your phone the moment one shows
up. By default it also pops a desktop notification and silently filters
out unpaid training material (Refreshers, Reference Versions).

You pick the delivery form that fits your setup:

- A Tampermonkey browser userscript, runs while any DA tab is open.
- A local Python script, runs on your PC in the background.
- A systemd service on a free Oracle Cloud VM, runs 24/7.

All three forms read the same dashboard, apply the same filters, and
send the same alerts to the same `ntfy.sh` topic.

## Key Features

- Push notifications to your phone via the free
  [ntfy.sh](https://ntfy.sh) relay (no account, no API key).
- Optional desktop notifications on the same machine.
- Independent toggles per channel: `PHONE_NOTIFY` and `DESKTOP_NOTIFY`
  in `shared/config.example.env`, or the matching switches in the
  userscript settings panel.
- Keyword filters: include only projects matching `KEYWORDS`,
  exclude any project containing `EXCLUDE_KEYWORDS`. Defaults exclude
  `refresher` and `reference version`.
- Auto-deduplication: each project alerts once. If a project drops off
  the dashboard and reappears later, it alerts again.
- Conservative polling: 5 minute minimum, hard-coded as a safety
  measure for your DA account.
- Session-expired alert: the Python monitor pings you on ntfy when your
  cookie stops working, so you do not silently miss projects.

## First Run

You need an `ntfy.sh` topic before anything else.

1. Install the ntfy app on your phone: Android
   (`io.heckel.ntfy`) or iOS.
2. Subscribe to a long, random topic name, for example
   `da-alert-a7f3b9c2e1d4`. Topics are public, so guessable names
   leak your alerts.
3. Hold on to that topic name. You will paste it into whichever form
   you pick below.

## Option A, Tampermonkey Userscript (recommended)

Easiest, most reliable, no cookie handling.

1. Install Tampermonkey for your browser.
2. Create a new script and paste the contents of
   `userscript/da-task-alert.user.js`.
3. Save with Ctrl+S.
4. Open `https://app.dataannotation.tech/workers/projects`.
5. A floating panel appears at the bottom-right of the page.
6. Click `Settings`, paste your ntfy topic, tweak filters, and save.
7. Click `Test ntfy` and `Test Desktop` to verify both channels.

The script reuses your existing browser session, so no cookie copying
is needed. It rechecks the page every 5 minutes (or whatever interval
you set, with 300 seconds as the floor).

## Option B, Local Python Script

Good for monitoring from your PC without keeping a tab open.

```
cd local
pip install -r requirements.txt
cp ../shared/config.example.env .env
python monitor.py
```

Edit `.env` and set:

- `NTFY_TOPIC`, your topic name.
- `DA_SESSION_COOKIE`, your DA session cookie. Get it from the browser:
  F12 -> Application -> Cookies -> copy the `conv_session` entry as
  `conv_session=<value>`.

Run it loop-style: `python monitor.py`.
Run it once (good for cron): `python monitor.py --once`.

## Option C, Oracle Free Tier Server

For 24/7 monitoring without leaving a PC on. Full instructions live in
`server/README.md`. The short version:

1. Provision an Always Free Ubuntu VM on Oracle Cloud.
2. Clone the repo to `/opt/da-task-alert`.
3. Copy `shared/config.example.env` to `/opt/da-task-alert/.env` and
   fill in `NTFY_TOPIC`, `DA_SESSION_COOKIE`, and set
   `DESKTOP_NOTIFY=false`.
4. Install the systemd unit from `server/da-task-alert.service`,
   then `enable` and `start` it.
5. Verify with `systemctl status da-task-alert` and
   `journalctl -u da-task-alert -f`.

## Configuration Reference

All forms read the same set of knobs. The userscript exposes them via
its Settings dialog, the Python forms via `.env`. See
`shared/config.example.env` for the full template.

| Key | Default | Notes |
|---|---|---|
| `NTFY_TOPIC` | (required) | Long random string, public topic. |
| `POLL_INTERVAL` | `300` | Seconds between checks. 300 is the floor. |
| `KEYWORDS` | (empty) | Comma-separated include filter. |
| `EXCLUDE_KEYWORDS` | `refresher, reference version` | Comma-separated exclude filter. |
| `PHONE_NOTIFY` | `true` | Disable to silence ntfy push only. |
| `DESKTOP_NOTIFY` | `true` | Disable on headless servers. |
| `DA_SESSION_COOKIE` | (Python only) | Session cookie from DevTools. |

## What Gets Notified

A new alert fires when, on the latest poll, a paid project appears that
was not present on the previous successful poll and that passes your
filters. The notification carries the project name, pay rate, and task
count, in a single line, for example:

```
New DA Project!
Translation Quality QA - $21.00/hr - 4 tasks
```

If more than three new projects show up in one poll, the userscript
also sends a single summary push so your phone is not spammed.

## Tips

- Pick a forgettable random ntfy topic. Anyone who guesses it sees
  your alerts.
- If you stop getting alerts in the Python form, check for a
  `Session Expired` ntfy push. That means your `DA_SESSION_COOKIE`
  needs refreshing from the browser.
- The seen-projects list lives in `local/seen_projects.json` (Python)
  or in Tampermonkey storage (userscript). Delete it (or hit
  `Clear Cache` in the panel) to re-alert everything currently on
  the dashboard.
