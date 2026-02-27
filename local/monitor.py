#!/usr/bin/env python3
"""
DA Task Alert - Local Monitor
Checks DataAnnotation for new paid projects and sends push notifications via ntfy.sh.
Works both locally and on headless servers (Oracle free tier).
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

# ─── Configuration ─────────────────────────────────────────────────────────────

import re as _re

load_dotenv()

NTFY_TOPIC = _re.sub(r"[^a-zA-Z0-9_\-]", "", os.getenv("NTFY_TOPIC", ""))
POLL_INTERVAL = max(300, int(os.getenv("POLL_INTERVAL", "300")))
DA_SESSION_COOKIE = os.getenv("DA_SESSION_COOKIE", "")
DESKTOP_NOTIFY = os.getenv("DESKTOP_NOTIFY", "true").lower() == "true"
KEYWORDS = [k.strip().lower() for k in os.getenv("KEYWORDS", "").split(",") if k.strip()]
EXCLUDE_KEYWORDS = [k.strip().lower() for k in
                    os.getenv("EXCLUDE_KEYWORDS", "refresher, reference version").split(",")
                    if k.strip()]

DA_PROJECTS_URL = "https://app.dataannotation.tech/workers/projects"
SEEN_FILE = Path(__file__).parent / "seen_projects.json"
MAX_SEEN_PROJECTS = 500

# ─── Seen Projects Persistence ─────────────────────────────────────────────────

def load_seen():
    if SEEN_FILE.exists():
        with open(SEEN_FILE) as f:
            data = json.load(f)
        return set(data.get("projects", []))
    return set()


def save_seen(projects):
    # Prune to prevent unbounded growth
    if len(projects) > MAX_SEEN_PROJECTS:
        projects = set(list(projects)[-MAX_SEEN_PROJECTS:])
    with open(SEEN_FILE, "w") as f:
        json.dump({"projects": list(projects)}, f, indent=2)


# ─── HTTP Session ──────────────────────────────────────────────────────────────

def create_session():
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    })

    if DA_SESSION_COOKIE:
        for cookie_pair in DA_SESSION_COOKIE.split(";"):
            cookie_pair = cookie_pair.strip()
            if "=" in cookie_pair:
                name, value = cookie_pair.split("=", 1)
                session.cookies.set(name.strip(), value.strip(),
                                     domain="app.dataannotation.tech")

    return session


def fetch_projects_page(session):
    """Fetch the DA projects page. Returns HTML string or None on failure."""
    try:
        resp = session.get(DA_PROJECTS_URL, timeout=30, allow_redirects=True)

        if "login" in resp.url.lower() or "sign_in" in resp.url.lower():
            print("[!] Session expired - redirected to login page.", file=sys.stderr)
            send_ntfy("DA Alert: Session Expired",
                      "Your DA session cookie has expired. Please update it.",
                      tags="warning", priority="urgent")
            return None

        if resp.status_code != 200:
            print(f"[!] HTTP {resp.status_code} from DA.", file=sys.stderr)
            return None

        return resp.text

    except requests.RequestException as e:
        print(f"[!] Request failed: {e}", file=sys.stderr)
        return None


# ─── HTML Parsing ──────────────────────────────────────────────────────────────
# DA page structure (as of 2026-04):
#   <h2>Projects</h2>
#   <table>
#     <thead><tr><th>Name</th><th>Pay</th><th>Tasks</th><th>Created</th>...</tr></thead>
#     <tbody><tr><td><a href="...">Project Name</a></td><td>$28.00/hr</td><td>9</td><td>Apr 4</td>...</tr></tbody>
#   </table>

def parse_projects(html):
    """Parse project listings from DA dashboard HTML - only the Projects section."""
    soup = BeautifulSoup(html, "html.parser")
    projects = []

    # Find the "Projects" heading
    projects_heading = None
    for h2 in soup.find_all("h2"):
        if h2.get_text(strip=True).lower() == "projects":
            projects_heading = h2
            break

    if not projects_heading:
        print("[!] Could not find 'Projects' heading on page.", file=sys.stderr)
        return projects

    # Find the table after the Projects heading
    table = None
    el = projects_heading.find_next_sibling()
    while el:
        if el.name == "table":
            table = el
            break
        if el.name == "h2":
            break
        nested = el.find("table")
        if nested:
            table = nested
            break
        el = el.find_next_sibling()

    if not table:
        print("[!] Could not find projects table.", file=sys.stderr)
        return projects

    # Determine column indices from header row
    name_col, pay_col, tasks_col, created_col = 0, -1, -1, -1
    header_row = table.find("thead")
    if header_row:
        for i, th in enumerate(header_row.find_all("th")):
            text = th.get_text(strip=True).lower()
            if text == "name": name_col = i
            elif text == "pay": pay_col = i
            elif text == "tasks": tasks_col = i
            elif text == "created": created_col = i

    # Scrape each data row
    for row in table.find_all("tr"):
        if row.find("th"):
            continue

        cells = row.find_all("td")
        if not cells:
            continue

        name_cell = cells[name_col] if name_col < len(cells) else None
        if not name_cell:
            continue

        link = name_cell.find("a")
        name = (link or name_cell).get_text(strip=True)
        if not name:
            continue

        pay = cells[pay_col].get_text(strip=True) if pay_col >= 0 and pay_col < len(cells) else ""
        tasks = cells[tasks_col].get_text(strip=True) if tasks_col >= 0 and tasks_col < len(cells) else ""
        created = cells[created_col].get_text(strip=True) if created_col >= 0 and created_col < len(cells) else ""

        projects.append({"name": name, "pay": pay, "tasks": tasks, "created": created})

    return projects


# ─── Filtering ─────────────────────────────────────────────────────────────────
# Filters out Refreshers, Reference Versions, and other non-paid content.

def filter_projects(projects):
    result = []
    for p in projects:
        name_lower = p["name"].lower()

        # Exclude refreshers, reference versions, etc.
        if any(kw in name_lower for kw in EXCLUDE_KEYWORDS):
            continue

        # If include keywords are set, only keep matching projects
        if KEYWORDS and not any(kw in name_lower for kw in KEYWORDS):
            continue

        result.append(p)
    return result


# ─── Notifications ─────────────────────────────────────────────────────────────

def send_ntfy(title, body, tags="money,rocket", priority="high"):
    if not NTFY_TOPIC:
        print("[!] No NTFY_TOPIC set. Skipping push notification.", file=sys.stderr)
        return

    try:
        resp = requests.post(
            f"https://ntfy.sh/{NTFY_TOPIC}",
            data=body.encode("utf-8"),
            headers={
                "Title": title,
                "Priority": priority,
                "Tags": tags,
            },
            timeout=10,
        )
        if resp.status_code < 300:
            print(f"  -> ntfy sent: {title}")
        else:
            print(f"  -> ntfy error: {resp.status_code}", file=sys.stderr)
    except requests.RequestException as e:
        print(f"  -> ntfy failed: {e}", file=sys.stderr)


def send_desktop_notification(title, body):
    if not DESKTOP_NOTIFY:
        return
    try:
        from plyer import notification
        notification.notify(title=title, message=body, timeout=10)
    except Exception as e:
        print(f"  -> Desktop notification failed: {e}", file=sys.stderr)


def alert_new_project(project):
    parts = [project["name"]]
    if project.get("pay"):
        parts.append(project["pay"])
    if project.get("tasks"):
        parts.append(f"{project['tasks']} tasks")
    body = " - ".join(parts)
    title = "New DA Project!"

    print(f"  [NEW] {body}")
    send_ntfy(title, body)
    send_desktop_notification(title, body)


# ─── Main Loop ─────────────────────────────────────────────────────────────────

is_first_check = True

def check_once(session, seen_projects):
    """Run a single check. Returns updated seen_projects set."""
    global is_first_check

    html = fetch_projects_page(session)
    if html is None:
        return seen_projects

    all_projects = parse_projects(html)
    filtered = filter_projects(all_projects)
    excluded_count = len(all_projects) - len(filtered)

    new_projects = [p for p in filtered if p["name"] not in seen_projects]

    if new_projects:
        if is_first_check and not seen_projects:
            print(f"[+] First run - found {len(new_projects)} paid project(s) on dashboard.")
        else:
            print(f"[+] Found {len(new_projects)} new project(s)!")
        for p in new_projects:
            alert_new_project(p)
            seen_projects.add(p["name"])
    else:
        print(f"[*] No new projects. ({len(filtered)} tracked, {excluded_count} filtered out)")

    is_first_check = False
    return seen_projects


def main():
    parser = argparse.ArgumentParser(description="DA Task Alert - Monitor DataAnnotation for new paid projects")
    parser.add_argument("--once", action="store_true", help="Run once and exit (for cron)")
    args = parser.parse_args()

    if not DA_SESSION_COOKIE:
        print("=" * 60)
        print("WARNING: No DA_SESSION_COOKIE set!")
        print("Copy your session cookie from browser DevTools:")
        print("  1. Go to app.dataannotation.tech")
        print("  2. Open DevTools (F12) > Application > Cookies")
        print("  3. Copy all cookie name=value pairs")
        print("  4. Set DA_SESSION_COOKIE in your .env file")
        print("=" * 60)
        print()

    if not NTFY_TOPIC:
        print("WARNING: No NTFY_TOPIC set. Push notifications disabled.")
        print("Set NTFY_TOPIC in your .env file.\n")

    session = create_session()
    seen_projects = load_seen()

    print(f"[*] DA Task Alert started")
    print(f"    Poll interval: {POLL_INTERVAL}s")
    print(f"    ntfy topic: {NTFY_TOPIC or '(not set)'}")
    print(f"    Desktop notify: {DESKTOP_NOTIFY}")
    print(f"    Include keywords: {', '.join(KEYWORDS) if KEYWORDS else '(all)'}")
    print(f"    Exclude keywords: {', '.join(EXCLUDE_KEYWORDS)}")
    print(f"    Previously seen: {len(seen_projects)} projects")
    print()

    if args.once:
        seen_projects = check_once(session, seen_projects)
        save_seen(seen_projects)
        return

    try:
        while True:
            seen_projects = check_once(session, seen_projects)
            save_seen(seen_projects)
            print(f"    Next check in {POLL_INTERVAL}s...\n")
            time.sleep(POLL_INTERVAL)
    except KeyboardInterrupt:
        print("\n[*] Stopped.")
        save_seen(seen_projects)


if __name__ == "__main__":
    main()
