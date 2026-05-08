# Security Policy

This document covers the security posture of DA Task Alert, the hardening
already in place, the threat model the tool is designed against, and how
to disclose vulnerabilities responsibly.

## Reporting a Vulnerability

Do NOT open a public GitHub issue for security vulnerabilities.

Email: **daniel.svs@outlook.com**

Include in your report:

- A description of the vulnerability.
- Steps to reproduce, or a proof of concept.
- Potential impact (data exposure, account risk, etc.).
- A suggested fix, if you have one.

### Response Timeline

- Acknowledgment: within 48 hours.
- Initial assessment: within 5 business days.
- Fix timeline: severity-driven (critical: 24 to 72 hours, high: 1 week,
  medium: 2 weeks).

## Threat Model

DA Task Alert is a single-user, self-hosted tool. The trust boundary
is the user's machine (browser or VM). The tool talks to two external
services: DataAnnotation (`app.dataannotation.tech`) and ntfy.sh. There
is no inbound network surface and no multi-tenant component.

In scope:

- Leakage of the user's DA session cookie.
- Leakage of the ntfy topic, which exposes alert content.
- Tampering with the userscript via a hostile DA page.
- Privilege escalation from the systemd service on the server.
- Unbounded resource use (storage, CPU) on local or server install.

Out of scope:

- Social engineering against the maintainer or users.
- Physical attacks on the user's host.
- Denial of service (DoS, DDoS) against ntfy.sh or DA.
- Vulnerabilities in third-party dependencies. Report those upstream
  (`requests`, `beautifulsoup4`, `python-dotenv`, `plyer`,
  Tampermonkey).

## Hardening In Place

### Secrets Handling

- The Python monitor reads the DA session cookie from a `.env` file.
  The repository's `.gitignore` excludes `.env`. The cookie is never
  logged, never sent anywhere besides DA itself, and never written to
  `seen_projects.json`.
- The userscript does not use a session cookie at all. It piggybacks on
  the user's existing logged-in browser session, scraping the live DOM.
- ntfy topic strings are sanitized to `[A-Za-z0-9_-]` before being
  used to build a URL, both in `local/monitor.py`
  (`_re.sub(r"[^a-zA-Z0-9_\-]", "", ...)`) and in
  `userscript/da-task-alert.user.js` (`sanitizeTopic`).

### Input Handling

- The userscript escapes any value rendered into its floating panel
  via an `escapeHtml` helper that uses `textContent` (no innerHTML
  injection of untrusted data).
- JSON parsing of the DA `data-props` blob is wrapped in `try / catch`
  in both forms. Parse failures do not crash the loop.

### Resource Limits

- Poll interval is clamped to a 300 second minimum
  (`max(300, int(...))` in Python; 300 second default in the
  userscript). This protects the user's DA account from rate-limit
  flags and protects ntfy.sh from accidental abuse.
- The seen-projects persistent set is pruned to the last 500 entries,
  preventing unbounded growth of `local/seen_projects.json` and
  `GM_setValue("seenProjects", ...)`.

### Network Surface

- The userscript declares `@connect ntfy.sh`, which restricts
  `GM_xmlhttpRequest` calls to that single host. It cannot be coerced
  into hitting an attacker-controlled origin.
- The Python monitor only makes outbound HTTPS requests to
  `app.dataannotation.tech` and `https://ntfy.sh`. There is no inbound
  listener.

### Server Hardening (`server/da-task-alert.service`)

The systemd unit applies the following sandbox directives:

- `NoNewPrivileges=true` blocks setuid escalation paths.
- `ProtectSystem=strict` makes most of the filesystem read-only.
- `ReadWritePaths=/opt/da-task-alert/local` limits writes to the
  install directory (where `seen_projects.json` lives).
- `PrivateTmp=true` isolates `/tmp` from other services.
- The unit runs as the unprivileged `ubuntu` user, never root.

## Operational Notes

- ntfy topics are public. Anyone who knows the topic name can
  subscribe to it. Pick a long, random topic such as
  `da-alert-a7f3b9c2e1d4`. Do not use guessable names.
- Session cookies expire. Treat them as short-lived secrets and replace
  them when the monitor warns you.
- If you fork or self-host the userscript, update the
  `@downloadURL` / `@updateURL` headers so Tampermonkey does not
  silently pull updates from this repository.

## Known Limitations

- No code-signing or integrity verification on the userscript.
  Tampermonkey's diff prompt on update is the only line of defence
  against a hostile auto-update push.
- The Python monitor does not use a keyring or OS credential store.
  Cookies live in plaintext in `.env` on disk.
- No transport pinning beyond standard HTTPS / CA validation.
