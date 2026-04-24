// ==UserScript==
// @name         DA Task Alert
// @namespace    https://github.com/WickedSoda/DA-Task-Alert
// @version      1.4.0
// @description  Monitor DataAnnotation for new paid projects and send push alerts via ntfy.sh
// @author       WickedSoda
// @match        https://app.dataannotation.tech/workers/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        GM_registerMenuCommand
// @connect      ntfy.sh
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // ─── Default Settings ───────────────────────────────────────────────
  const DEFAULTS = {
    ntfyTopic: "",
    pollInterval: 300, // seconds
    keywords: "",
    excludeKeywords: "refresher, reference version",
    desktopNotify: true,
    enabled: true,
  };

  // ─── Settings helpers ───────────────────────────────────────────────
  function getSetting(key) {
    return GM_getValue(key, DEFAULTS[key]);
  }

  function setSetting(key, value) {
    GM_setValue(key, value);
  }

  // ─── Security helpers ──────────────────────────────────────────────
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function sanitizeTopic(topic) {
    // ntfy topics: alphanumeric, dashes, underscores only
    return topic.replace(/[^a-zA-Z0-9_\-]/g, "");
  }

  // ─── State ──────────────────────────────────────────────────────────
  const MAX_SEEN_PROJECTS = 500;
  let seenProjects = new Set(JSON.parse(GM_getValue("seenProjects", "[]")));
  let lastCheckTime = GM_getValue("lastCheckTime", "Never");
  let newThisSession = 0;
  let pollTimer = null;

  function pruneSeenProjects() {
    if (seenProjects.size > MAX_SEEN_PROJECTS) {
      const arr = [...seenProjects];
      seenProjects = new Set(arr.slice(arr.length - MAX_SEEN_PROJECTS));
      GM_setValue("seenProjects", JSON.stringify([...seenProjects]));
    }
  }

  // ─── Page Fetching ──────────────────────────────────────────────────
  // DA is a SPA and blocks cross-origin iframe access, so we:
  //   - On the projects page: scrape live DOM, then reload for fresh data on polls
  //   - On other pages: navigate to projects page first

  function isOnProjectsPage() {
    return window.location.pathname.includes("/workers/projects");
  }

  // ─── DOM Scraping ───────────────────────────────────────────────────
  // DA renders the dashboard client-side via React. The project list is
  // embedded into a hybrid root div as a JSON blob on data-props. That's
  // the one source of truth - pre-2026 layouts with a rendered <table>
  // are gone, so scraping the DOM for a <th>Tasks</th> returns nothing.
  //
  // JSON shape (as of 2026-04):
  //   { dashboardMerchTargeting: { projects: [
  //       { name, id, pay, availableTasksFor, created,
  //         bonusBadge, bonusDescription, ... }
  //     ] },
  //     hiddenProjects: { <id>: true },
  //     reportableProjectsInfo: [ ... ] }   // already-started projects
  //
  // We read from dashboardMerchTargeting.projects (the dashboard feed)
  // and skip any id present in hiddenProjects.

  const HYBRID_ROOT_ID = "workers/WorkerProjectsTable-hybrid-root";

  function scrapeProjects(doc) {
    const projects = [];

    const bodyText = (doc.body?.innerText || "").toLowerCase();
    if (
      bodyText.includes("there aren't any projects available") ||
      bodyText.includes("no projects available for you")
    ) {
      console.log("[DA Alert] Empty state - no projects available.");
      return projects;
    }

    const root = doc.getElementById(HYBRID_ROOT_ID);
    const raw = root?.getAttribute("data-props");
    if (!raw) {
      console.warn(
        "[DA Alert] Hybrid root div not found. DA may have changed its layout.",
      );
      return projects;
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error("[DA Alert] Failed to parse data-props JSON:", e);
      return projects;
    }

    const hidden = new Set(Object.keys(data.hiddenProjects || {}));
    const rawProjects =
      (data.dashboardMerchTargeting && data.dashboardMerchTargeting.projects) ||
      [];

    for (const p of rawProjects) {
      const pid = p.id || "";
      if (hidden.has(pid)) continue;
      const name = (p.name || "").trim();
      if (!name) continue;
      projects.push({
        name,
        id: pid,
        pay: (p.pay || "").trim(),
        tasks: String(p.availableTasksFor || "").trim(),
        created: p.created || "",
      });
    }

    console.log(
      "[DA Alert] Scraped projects from data-props:",
      projects.map((p) => p.name),
    );
    return projects;
  }

  // ─── Filtering ──────────────────────────────────────────────────────
  // Filters out Refreshers, Reference Versions, and other excluded keywords.
  // Only keeps paid project notifications.

  function filterProjects(projects) {
    const keywordsStr = getSetting("keywords").trim();
    const includeKeywords = keywordsStr
      ? keywordsStr
          .split(",")
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean)
      : [];

    const excludeStr = getSetting("excludeKeywords").trim();
    const excludeKeywords = excludeStr
      ? excludeStr
          .split(",")
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean)
      : [];

    return projects.filter((p) => {
      // Empty pay = unpaid training/welcome/refresher. The JSON feed
      // returns these alongside real projects.
      if (!p.pay) return false;

      const nameLower = p.name.toLowerCase();

      // Exclude refreshers, reference versions, etc.
      if (excludeKeywords.some((k) => nameLower.includes(k))) return false;

      // If include keywords are set, only keep matching projects
      if (includeKeywords.length > 0) {
        if (!includeKeywords.some((k) => nameLower.includes(k))) return false;
      }

      return true;
    });
  }

  // ─── Notifications ─────────────────────────────────────────────────
  function sendNtfyAlert(
    title,
    body,
    tags = "money,rocket",
    priority = "high",
  ) {
    const topic = sanitizeTopic(getSetting("ntfyTopic"));
    if (!topic) {
      console.warn("[DA Alert] No ntfy topic configured.");
      return;
    }

    GM_xmlhttpRequest({
      method: "POST",
      url: `https://ntfy.sh/${topic}`,
      headers: {
        Title: title,
        Priority: priority,
        Tags: tags,
      },
      data: body,
      onload: (res) => {
        if (res.status >= 200 && res.status < 300) {
          console.log("[DA Alert] ntfy sent:", body);
        } else {
          console.error("[DA Alert] ntfy error:", res.status, res.responseText);
        }
      },
      onerror: (err) => {
        console.error("[DA Alert] ntfy failed:", err);
      },
    });
  }

  function sendDesktopNotification(title, body) {
    if (!getSetting("desktopNotify")) return;

    if (typeof GM_notification === "function") {
      GM_notification({ title, text: body, timeout: 10000 });
    } else if (Notification.permission === "granted") {
      new Notification(title, { body });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") new Notification(title, { body });
      });
    }
  }

  function alertNewProjects(newProjects) {
    newProjects.forEach((p) => {
      const title = "New DA Project!";
      const parts = [p.name];
      if (p.pay) parts.push(p.pay);
      if (p.tasks) parts.push(`${p.tasks} tasks`);
      const body = parts.join(" - ");

      sendNtfyAlert(title, body);
      sendDesktopNotification(title, body);
    });

    if (newProjects.length > 3) {
      sendNtfyAlert(
        "DA Alert: Multiple New Projects",
        `${newProjects.length} new projects available!`,
      );
    }
  }

  // ─── Main Check Logic ──────────────────────────────────────────────
  let isChecking = false;
  let isFirstCheck = seenProjects.size === 0;

  function checkForNewProjects() {
    if (!getSetting("enabled") || isChecking) return;

    if (!isOnProjectsPage()) {
      console.log("[DA Alert] Not on projects page, skipping check.");
      updateStatusUI("Navigate to Projects", "#f0ad4e");
      return;
    }

    isChecking = true;
    console.log("[DA Alert] Checking for new projects...");
    updateStatusUI("Checking...", "#f0ad4e");

    const freshDoc = document;

    const allProjects = scrapeProjects(freshDoc);
    console.log(
      `[DA Alert] Scraped ${allProjects.length} total project(s):`,
      allProjects.map((p) => p.name),
    );
    const filtered = filterProjects(allProjects);
    console.log(
      `[DA Alert] After filtering: ${filtered.length} paid, ${allProjects.length - filtered.length} excluded`,
    );
    console.log(`[DA Alert] Currently seen: ${seenProjects.size} project(s)`);

    // Remove projects from seen list that are no longer on the dashboard.
    // This way, if a project disappears and reappears later, it gets pinged again.
    const currentIds = new Set(allProjects.map((p) => p.id));
    const removed = [...seenProjects].filter((id) => !currentIds.has(id));
    if (removed.length > 0) {
      removed.forEach((id) => seenProjects.delete(id));
      console.log(
        `[DA Alert] Removed ${removed.length} project(s) no longer on dashboard:`,
        removed,
      );
    }

    const newProjects = filtered.filter((p) => !seenProjects.has(p.id));

    if (newProjects.length > 0) {
      if (isFirstCheck) {
        console.log(
          `[DA Alert] First run - found ${newProjects.length} paid project(s) on dashboard.`,
        );
      } else {
        console.log(`[DA Alert] Found ${newProjects.length} new project(s)!`);
      }
      alertNewProjects(newProjects);
      isFirstCheck = false;

      newProjects.forEach((p) => seenProjects.add(p.id));
      GM_setValue("seenProjects", JSON.stringify([...seenProjects]));
      newThisSession += newProjects.length;
    } else {
      console.log(
        `[DA Alert] No new projects. (${filtered.length} tracked, ${allProjects.length - filtered.length} filtered out)`,
      );
      isFirstCheck = false;
    }

    // Save updated seen list (includes removals)
    GM_setValue("seenProjects", JSON.stringify([...seenProjects]));

    lastCheckTime = new Date().toLocaleTimeString();
    GM_setValue("lastCheckTime", lastCheckTime);
    updateStatusUI("Active", "#5cb85c");
    updateStatusDetails(filtered.length, newThisSession);
    isChecking = false;
  }

  // ─── Floating Status UI ────────────────────────────────────────────
  function createStatusUI() {
    const panel = document.createElement("div");
    panel.id = "da-alert-panel";
    panel.innerHTML = `
      <style>
        #da-alert-panel {
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: #1a1a2e;
          color: #e0e0e0;
          border: 1px solid #333;
          border-radius: 10px;
          padding: 12px 16px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 13px;
          z-index: 99999;
          min-width: 220px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.4);
          transition: all 0.3s ease;
        }
        #da-alert-panel.collapsed {
          min-width: auto;
          padding: 8px 12px;
          cursor: pointer;
        }
        #da-alert-panel.collapsed .da-alert-body { display: none; }
        #da-alert-panel .da-alert-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 8px;
          font-weight: 600;
        }
        #da-alert-panel.collapsed .da-alert-header { margin-bottom: 0; }
        #da-alert-panel .da-status-dot {
          width: 8px; height: 8px; border-radius: 50%;
          display: inline-block; margin-right: 6px;
        }
        #da-alert-panel .da-alert-body { font-size: 12px; line-height: 1.6; }
        #da-alert-panel .da-alert-body span { color: #aaa; }
        #da-alert-panel button {
          background: #2d2d44;
          color: #e0e0e0;
          border: 1px solid #444;
          border-radius: 5px;
          padding: 4px 10px;
          cursor: pointer;
          font-size: 11px;
          margin-top: 8px;
          margin-right: 4px;
          transition: background 0.2s;
        }
        #da-alert-panel button:hover { background: #3d3d55; }
      </style>
      <div class="da-alert-header">
        <div>
          <span class="da-status-dot" id="da-status-dot" style="background:#5cb85c"></span>
          <span id="da-status-text">Starting...</span>
        </div>
        <span id="da-toggle" style="cursor:pointer;font-size:16px;" title="Collapse">&#9660;</span>
      </div>
      <div class="da-alert-body">
        <div><span>Last check:</span> <span id="da-last-check">${escapeHtml(lastCheckTime)}</span></div>
        <div><span>Paid projects:</span> <span id="da-project-count">0</span></div>
        <div><span>New this session:</span> <span id="da-new-count">0</span></div>
        <div><span>ntfy topic:</span> <span id="da-topic">${escapeHtml(getSetting("ntfyTopic") || "(not set)")}</span></div>
        <div style="margin-top:8px">
          <button id="da-btn-settings" title="Settings">Settings</button>
          <button id="da-btn-check" title="Check now">Check Now</button>
          <button id="da-btn-clear" title="Clear cache and re-alert all current projects">Clear Cache</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById("da-toggle").addEventListener("click", () => {
      panel.classList.toggle("collapsed");
      document.getElementById("da-toggle").innerHTML = panel.classList.contains(
        "collapsed",
      )
        ? "&#9650;"
        : "&#9660;";
    });

    document
      .getElementById("da-btn-settings")
      .addEventListener("click", openSettings);
    document
      .getElementById("da-btn-check")
      .addEventListener("click", () => checkForNewProjects());
    document.getElementById("da-btn-clear").addEventListener("click", () => {
      seenProjects.clear();
      GM_setValue("seenProjects", "[]");
      isFirstCheck = true;
      newThisSession = 0;
      updateStatusDetails(0, 0);
      console.log("[DA Alert] Cache cleared. Re-checking...");
      checkForNewProjects();
    });
  }

  function updateStatusUI(text, color) {
    const dot = document.getElementById("da-status-dot");
    const textEl = document.getElementById("da-status-text");
    if (dot) dot.style.background = color;
    if (textEl) textEl.textContent = text;
    const checkEl = document.getElementById("da-last-check");
    if (checkEl) checkEl.textContent = lastCheckTime;
  }

  function updateStatusDetails(totalCount, newCount) {
    const projEl = document.getElementById("da-project-count");
    const newEl = document.getElementById("da-new-count");
    if (projEl) projEl.textContent = totalCount;
    if (newEl) newEl.textContent = newCount;
  }

  // ─── Settings Modal ────────────────────────────────────────────────
  function openSettings() {
    const existing = document.getElementById("da-settings-modal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.id = "da-settings-modal";
    modal.innerHTML = `
      <style>
        #da-settings-modal {
          position: fixed; inset: 0; background: rgba(0,0,0,0.6);
          display: flex; align-items: center; justify-content: center;
          z-index: 100000;
        }
        #da-settings-modal .modal-content {
          background: #1a1a2e; color: #e0e0e0; border-radius: 12px;
          padding: 24px; max-width: 400px; width: 90%;
          box-shadow: 0 8px 30px rgba(0,0,0,0.5);
        }
        #da-settings-modal h3 { margin-top: 0; }
        #da-settings-modal label { display: block; margin-top: 12px; font-size: 12px; color: #aaa; }
        #da-settings-modal input[type="text"],
        #da-settings-modal input[type="number"] {
          width: 100%; padding: 8px; margin-top: 4px;
          background: #2d2d44; color: #e0e0e0; border: 1px solid #444;
          border-radius: 6px; box-sizing: border-box;
        }
        #da-settings-modal .modal-buttons {
          margin-top: 16px;
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          flex-wrap: nowrap;
        }
        #da-settings-modal .modal-buttons button {
          background: #2d2d44; color: #e0e0e0; border: 1px solid #444;
          border-radius: 6px; padding: 8px 12px; cursor: pointer;
          white-space: nowrap;
        }
        #da-settings-modal .modal-buttons button.primary {
          background: #4a90d9; border-color: #4a90d9;
        }
      </style>
      <div class="modal-content">
        <h3>DA Task Alert Settings</h3>

        <label>ntfy.sh Topic (required for push notifications)</label>
        <input type="text" id="da-set-topic" placeholder="da-alert-your-secret-topic">

        <label>Poll Interval (seconds, min 300)</label>
        <input type="number" id="da-set-interval" min="300">

        <label>Only alert for keywords (comma-separated, empty = all paid projects)</label>
        <input type="text" id="da-set-keywords" placeholder="coding, python, writing">

        <label>Exclude keywords (comma-separated, silenced)</label>
        <input type="text" id="da-set-exclude" placeholder="refresher, reference version">

        <label>
          <input type="checkbox" id="da-set-desktop"> Desktop Notifications
        </label>

        <label>
          <input type="checkbox" id="da-set-enabled"> Monitoring Enabled
        </label>

        <div class="modal-buttons">
          <button id="da-set-cancel">Cancel</button>
          <button id="da-set-save" class="primary">Save</button>
          <button id="da-set-test">Test ntfy</button>
          <button id="da-set-test-desktop">Test Desktop</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Set input values safely via DOM properties (not innerHTML) to prevent XSS
    document.getElementById("da-set-topic").value = getSetting("ntfyTopic");
    document.getElementById("da-set-interval").value =
      getSetting("pollInterval");
    document.getElementById("da-set-keywords").value = getSetting("keywords");
    document.getElementById("da-set-exclude").value =
      getSetting("excludeKeywords");
    document.getElementById("da-set-desktop").checked =
      getSetting("desktopNotify");
    document.getElementById("da-set-enabled").checked = getSetting("enabled");

    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    document
      .getElementById("da-set-cancel")
      .addEventListener("click", () => modal.remove());

    document.getElementById("da-set-test").addEventListener("click", () => {
      const topic = sanitizeTopic(
        document.getElementById("da-set-topic").value,
      );
      if (!topic) {
        alert("Enter an ntfy topic first!");
        return;
      }
      GM_xmlhttpRequest({
        method: "POST",
        url: `https://ntfy.sh/${topic}`,
        headers: {
          Title: "DA Alert Test",
          Tags: "white_check_mark",
          Priority: "default",
        },
        data: "If you see this, notifications are working!",
        onload: () => alert("Test notification sent! Check your phone."),
        onerror: () => alert("Failed to send. Check the topic name."),
      });
    });

    document
      .getElementById("da-set-test-desktop")
      .addEventListener("click", () => {
        if (typeof GM_notification === "function") {
          GM_notification({
            title: "DA Alert Test",
            text: "If you see this, desktop notifications are working!",
            timeout: 10000,
          });
          alert("Desktop notification sent! You should see it now.");
        } else if (Notification.permission === "granted") {
          new Notification("DA Alert Test", {
            body: "If you see this, desktop notifications are working!",
          });
          alert("Desktop notification sent!");
        } else {
          Notification.requestPermission().then((perm) => {
            if (perm === "granted") {
              new Notification("DA Alert Test", {
                body: "If you see this, desktop notifications are working!",
              });
              alert("Desktop notification sent!");
            } else {
              alert(
                "Desktop notifications were denied. Please allow them in browser settings.",
              );
            }
          });
        }
      });

    document.getElementById("da-set-save").addEventListener("click", () => {
      const interval = Math.max(
        300,
        parseInt(document.getElementById("da-set-interval").value) || 300,
      );

      setSetting(
        "ntfyTopic",
        sanitizeTopic(document.getElementById("da-set-topic").value.trim()),
      );
      setSetting("pollInterval", interval);
      setSetting(
        "keywords",
        document.getElementById("da-set-keywords").value.trim(),
      );
      setSetting(
        "excludeKeywords",
        document.getElementById("da-set-exclude").value.trim(),
      );
      setSetting(
        "desktopNotify",
        document.getElementById("da-set-desktop").checked,
      );
      setSetting("enabled", document.getElementById("da-set-enabled").checked);

      const topicEl = document.getElementById("da-topic");
      if (topicEl) topicEl.textContent = getSetting("ntfyTopic") || "(not set)";

      startPolling();
      modal.remove();
      console.log("[DA Alert] Settings saved.");
    });
  }

  // ─── Polling ───────────────────────────────────────────────────────
  // On each poll: reload the page so the SPA fetches fresh data from the server,
  // then scrape the newly rendered DOM after reload.
  // The script re-initializes automatically after reload (Tampermonkey re-injects it).

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);

    const interval = getSetting("pollInterval") * 1000;
    pollTimer = setInterval(() => {
      if (!getSetting("enabled")) return;

      if (isOnProjectsPage()) {
        // Reload the page - Tampermonkey will re-inject the script,
        // which triggers init() -> checkForNewProjects() on the fresh DOM
        console.log("[DA Alert] Polling: reloading page for fresh data...");
        GM_setValue("pendingCheck", "true");
        window.location.reload();
      } else {
        console.log("[DA Alert] Not on projects page, skipping poll.");
        updateStatusUI("Navigate to Projects", "#f0ad4e");
      }
    }, interval);

    console.log(`[DA Alert] Polling every ${getSetting("pollInterval")}s`);
  }

  // ─── Menu command ──────────────────────────────────────────────────
  GM_registerMenuCommand("DA Task Alert Settings", openSettings);

  // ─── Init ──────────────────────────────────────────────────────────
  function init() {
    console.log("[DA Alert] Initializing...");
    createStatusUI();

    // Check if this is a reload from polling, or a fresh page load
    const isPollReload = GM_getValue("pendingCheck", "false") === "true";
    if (isPollReload) {
      GM_setValue("pendingCheck", "false");
    }

    // Wait for SPA to render, then check
    setTimeout(() => {
      checkForNewProjects();
      startPolling();
    }, 5000);
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init);
  }
})();
