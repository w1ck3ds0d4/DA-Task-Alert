# DA-Task-Alert v1 Roadmap

## What v1 is

Monitor DataAnnotation.tech for new paid projects and push alerts via
ntfy.sh. Three deployment modes for the same logic: a Tampermonkey userscript
in your browser, a Python CLI on your laptop, or a hardened Python service on
an Oracle Cloud free-tier VM with systemd.

## Current state

Phase 1 (Tampermonkey userscript) and Phase 2 (Python monitor with session
cookies, ntfy push, desktop notifications, seen-projects persistence, Oracle
deployment guide, systemd hardening, `--once` cron mode) are shipped. CI runs
ruff lint + format (non-blocking) and pip-audit. No tests. Phase 3 (Slack /
Discord / email channels, project detail scraping, SQLite history, pay-rate
trends) is planned but not started.

## v1 acceptance criteria

- [x] Tampermonkey userscript v1.2.0 with auto-update metadata
- [x] Python CLI with session cookies, ntfy push, desktop notifications
- [x] Seen-projects persistence (500-entry cap)
- [x] 5-minute poll floor + session expiry detection
- [x] Oracle Cloud deploy guide + systemd hardening
- [x] `--once` cron mode
- [x] ruff lint + format CI (non-blocking) + pip-audit
- [x] SecureCheck workflow wired
- [ ] At least one alternative alert channel (Slack OR Discord webhook)
- [ ] Project detail scraping (description, requirements) at alert time
- [ ] SQLite historical store with simple "appeared on" / "last seen" timestamps
- [ ] Two integration tests under `tests/` (parser smoke + ntfy stub)
- [ ] CI gate is hard (ruff blocking) once formatting is stable
- [ ] Documented manual smoke: laptop run + Oracle deploy + Tampermonkey side by side
- [ ] Tag `v1.0.0` after the smoke matrix passes

## Milestones to v1

### M1. Add Slack OR Discord webhook channel (S)

- [ ] Pick one (Discord is simpler) and add `--notify-discord <url>` (or env var)
- [ ] Fan-out: project alert produces ntfy + chosen webhook simultaneously
- [ ] Document in README

**Acceptance:** running the monitor with both flags posts to ntfy AND the chosen channel.

### M2. Project detail scraping (S/M)

- [ ] Fetch the project detail page when a new project appears
- [ ] Extract description + requirements + pay rate when visible
- [ ] Include those fields in the notification body

**Acceptance:** an ntfy push surfaces enough info to decide whether to open it without visiting DA.

### M3. SQLite history (S)

- [ ] Replace the 500-entry JSON seen-set with SQLite (`history.db`)
- [ ] Track `first_seen`, `last_seen`, optional `pay_rate`, `gone_at`
- [ ] One-shot migration from existing JSON
- [ ] `--stats` flag prints a 30-day summary (count seen, average pay)

**Acceptance:** running `--stats` produces a meaningful trend table from at least a week of data.

### M4. Tests (S)

- [ ] Add `tests/` with pytest
- [ ] Parser test: feed a saved HTML snapshot, assert expected projects parsed
- [ ] ntfy + Discord stub test (mock HTTP)
- [ ] Wire `pytest` into `ci.yml` (blocking)

**Acceptance:** at least 5 tests; CI runs them; main gates on them.

### M5. Tag + smoke (S)

- [ ] Bump userscript to v1.3.0
- [ ] CHANGELOG entry
- [ ] Manual smoke across all three deployment modes
- [ ] Tag `v1.0.0`

**Acceptance:** documented per-mode smoke pass; tag pushed.

## Beyond v1 (post-1.0 polish)

- Email (SMTP) channel
- Multiple ntfy topics / multi-user
- Pay-rate trend chart (small static page)
- Resilience against DA UI changes (e.g., two parser strategies, fail-fast on both)

## Out of scope for v1

- Hosted SaaS edition
- DA OAuth / paid API (DA doesn't offer one)
- Mobile-only deployment (Tampermonkey via Android Firefox works but isn't a target)
