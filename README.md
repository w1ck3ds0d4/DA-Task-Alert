# DA Task Alert

Monitors DataAnnotation for new paid projects and sends push alerts to your phone via [ntfy.sh](https://ntfy.sh). Automatically filters out Refreshers and Reference Versions.

## How It Works

DA Task Alert silently fetches the DataAnnotation projects page in the background on a configurable interval (default: every 5 minutes). When new paid projects appear, it sends a push notification to your phone and/or a desktop notification. Unpaid training content (Refreshers, Reference Versions) is filtered out by default.

## Three Ways to Run

| Method | Best For | Requires Browser? |
|--------|----------|-------------------|
| **Tampermonkey Userscript** | Easiest setup, most reliable | Yes (runs while any DA page is open) |
| **Local Python Script** | Background monitoring on your PC | No (uses session cookies) |
| **Oracle Free Tier Server** | 24/7 monitoring, no PC needed | No (headless server) |

## Quick Start

### 1. Set Up ntfy.sh (All Methods)

1. Install the **ntfy** app on your phone ([Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) / [iOS](https://apps.apple.com/us/app/ntfy/id1625396347))
2. Open the app and subscribe to a topic with a long random name (e.g., `da-alert-a7f3b9c2e1d4`)
3. That's it - you'll get push notifications whenever the script sends alerts to this topic

### 2. Pick Your Method

#### Option A: Tampermonkey Userscript (Recommended)

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Create a new script in Tampermonkey and paste the contents of `userscript/da-task-alert.user.js`
3. Save the script (Ctrl+S)
4. Go to [app.dataannotation.tech](https://app.dataannotation.tech/workers/projects)
5. A floating panel appears in the bottom-right corner
6. Click **Settings**, enter your ntfy topic, and configure filters
7. Click **Test ntfy** to verify push notifications work
8. Click **Test Desktop** to verify desktop notifications work

No credentials needed - it uses your existing browser session. It fetches fresh project data in the background without reloading the page.

#### Option B: Local Python Script

```bash
cd local
pip install -r requirements.txt
cp ../shared/config.example.env .env
# Edit .env with your settings
python monitor.py
```

Required `.env` settings:
- `NTFY_TOPIC` - your ntfy topic name
- `DA_SESSION_COOKIE` - your session cookie (see below)

To get your session cookie: open DA in your browser > F12 > Application > Cookies > copy the `conv_session` cookie as `conv_session=<value>`.

Run once (for cron): `python monitor.py --once`

#### Option C: Oracle Free Tier Server

See [server/README.md](server/README.md) for the full deployment guide.

## Configuration

**Tampermonkey**: configured via the Settings panel in the floating UI (bottom-right on any DA page).

**Python script**: configured via a `.env` file (copy from `shared/config.example.env`).

| Setting | Default | Description |
|---------|---------|-------------|
| `NTFY_TOPIC` | *(required)* | Your ntfy.sh topic name (alphanumeric, dashes, underscores) |
| `POLL_INTERVAL` | `300` | Seconds between checks (minimum 300 enforced) |
| `KEYWORDS` | *(empty)* | Only alert for matching projects (empty = all paid projects) |
| `EXCLUDE_KEYWORDS` | `refresher, reference version` | Silence notifications for these (unpaid training) |
| `DESKTOP_NOTIFY` | `true` | Show desktop notifications |
| `DA_SESSION_COOKIE` | *(Python only)* | Session cookie from browser DevTools |

## Security

- **ntfy topics are public** - anyone who knows the topic name can subscribe. Use a long random string (e.g., `da-alert-a7f3b9c2e1d4`), not something guessable.
- **Session cookies are secrets** - the `.env` file is gitignored. Never commit it.
- **Topic names are sanitized** - only alphanumeric characters, dashes, and underscores are allowed.
- **Seen projects are pruned** - capped at 500 entries to prevent unbounded storage growth.
- **Poll interval enforced** - minimum 300 seconds (5 minutes) to avoid rate limiting or account flags on DA.

## Important Notes

- **5-minute minimum poll interval** - DA community standard; polling faster may flag your account
- **Session cookies expire** - the Python script will alert you via ntfy when your session expires
- **DOM selectors may break** - if DA updates their frontend, the scraping logic may need updating. The script targets the `<h2>Projects</h2>` heading and the table that follows it.

## Project Structure

```
DA-Task-Alert/
├── userscript/
│   └── da-task-alert.user.js    # Tampermonkey userscript
├── local/
│   ├── monitor.py               # Python monitoring script
│   └── requirements.txt
├── server/
│   ├── da-task-alert.service    # systemd unit for Oracle/Linux
│   └── README.md                # Server deployment guide
└── shared/
    └── config.example.env       # Configuration template
```

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE).
