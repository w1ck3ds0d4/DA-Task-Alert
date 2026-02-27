// ==UserScript==
// @name         DA Task Alert
// @namespace    https://github.com/WickedSoda/DA-Task-Alert
// @version      1.1.0
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
  // DA is a single-page app - raw fetch() returns an empty shell without
  // JS-rendered content. We must either:
  //   1. Scrape the live document (if we're on the projects page)
  //   2. Use a hidden iframe (which runs JS and renders the full page)

  const DA_PROJECTS_URL = "https://app.dataannotation.tech/workers/projects";

  function isOnProjectsPage() {
    return window.location.pathname.includes("/workers/projects");
  }

  function getLiveDocument() {
    return document;
  }

  function getDocViaIframe() {
    return new Promise((resolve) => {
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
      iframe.src = DA_PROJECTS_URL;

      const timeout = setTimeout(() => {
        console.warn("[DA Alert] Iframe timed out.");
        iframe.remove();
        resolve(null);
      }, 30000);

      iframe.onload = () => {
        // Wait for SPA to render content inside the iframe
        let attempts = 0;
        const waitForContent = setInterval(() => {
          attempts++;
          try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            const hasProjects = iframeDoc.querySelector("h2");
            if (hasProjects || attempts >= 20) {
              clearInterval(waitForContent);
              clearTimeout(timeout);
              resolve(iframeDoc);
              // Clean up iframe after a short delay so DOM stays accessible
              setTimeout(() => iframe.remove(), 500);
            }
          } catch (e) {
            // Cross-origin error
            clearInterval(waitForContent);
            clearTimeout(timeout);
            console.error("[DA Alert] Iframe cross-origin blocked:", e);
            iframe.remove();
            resolve(null);
          }
        }, 500);
      };

      iframe.onerror = () => {
        clearTimeout(timeout);
        iframe.remove();
        resolve(null);
      };

      document.body.appendChild(iframe);
    });
  }

  // ─── DOM Scraping ───────────────────────────────────────────────────
  // DA uses Tailwind CSS with divs, not semantic HTML tables.
  // Actual structure (as of 2026-04):
  //   <h3 class="tw-text-h3 ...">Projects</h3>
  //   ...
  //   <div class="active-table">
  //     (header row with Name, Pay, Tasks, Created columns)
  //     (data rows with project links)
  //   </div>

  function scrapeProjects(doc) {
    const projects = [];

    // Strategy 1: Find the "Projects" heading (could be h2, h3, or any heading)
    let projectsHeading = null;
    for (const el of doc.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
      if (el.textContent.trim().toLowerCase() === "projects") {
        projectsHeading = el;
        break;
      }
    }

    if (!projectsHeading) {
      console.warn("[DA Alert] Could not find 'Projects' heading on page.");
      return projects;
    }

    console.log("[DA Alert] Found Projects heading:", projectsHeading.tagName);

    // Strategy 2: Find the active-table div or any table-like container after the heading
    // Walk up to find the parent section, then look for the table within it
    let container = null;

    // Look for .active-table in the same section
    let parent = projectsHeading.closest("div");
    while (parent && !container) {
      container = parent.querySelector(".active-table, table");
      if (!container) parent = parent.parentElement;
    }

    // Fallback: search the whole document
    if (!container) {
      container = doc.querySelector(".active-table, table");
    }

    if (!container) {
      console.warn("[DA Alert] Could not find projects table/container.");
      return projects;
    }

    console.log("[DA Alert] Found container:", container.className.substring(0, 50));

    // Strategy 3: If it's an actual <table>, parse traditionally
    if (container.tagName === "TABLE") {
      const rows = container.querySelectorAll("tbody tr, tr");
      for (const row of rows) {
        if (row.querySelector("th")) continue;
        const cells = row.querySelectorAll("td");
        if (cells.length === 0) continue;
        const link = cells[0].querySelector("a");
        const name = (link || cells[0]).textContent.trim();
        if (!name) continue;
        const pay = cells[1] ? cells[1].textContent.trim() : "";
        const tasks = cells[2] ? cells[2].textContent.trim() : "";
        const created = cells[3] ? cells[3].textContent.trim() : "";
        projects.push({ name, pay, tasks, created, id: name });
      }
      return projects;
    }

    // Strategy 4: Div-based table (Tailwind) - find all links to projects
    // Each project row contains a link with the project name
    const links = container.querySelectorAll("a[href]");
    for (const link of links) {
      const name = link.textContent.trim();
      const href = link.getAttribute("href") || "";

      // Skip non-project links (e.g., navigation, buttons)
      if (!name || name.length < 5) continue;
      if (!href.includes("project") && !href.includes("task") && !href.includes("/workers/")) continue;

      // Try to find pay/tasks/created in the same row (parent container)
      const row = link.closest("tr, [class*='tw-']")?.parentElement?.closest("div, tr") || link.parentElement;
      const rowText = row ? row.textContent : "";

      const payMatch = rowText.match(/\$[\d.]+\/hr/);
      const pay = payMatch ? payMatch[0] : "";

      // Extract just the task count number near the project
      const tasks = "";
      const created = "";

      projects.push({ name, pay, tasks, created, id: name });
    }

    // Strategy 5: If no links found, try getting all text rows from the container
    if (projects.length === 0) {
      console.log("[DA Alert] No links found in container, trying text rows...");
      // Get all direct child divs that look like rows (have multiple child divs)
      const rows = container.querySelectorAll("div > div");
      for (const row of rows) {
        const text = row.textContent.trim();
        // Skip header-like rows and very short text
        if (text.toLowerCase().startsWith("name") || text.length < 5) continue;
        if (text.includes("Hide") && text.includes("Created")) continue; // header row

        // First meaningful text chunk is likely the project name
        const firstChild = row.querySelector("a, span, div");
        const name = firstChild ? firstChild.textContent.trim() : text.substring(0, 100);
        if (name && name.length > 5) {
          const payMatch = text.match(/\$[\d.]+\/hr/);
          projects.push({ name, pay: payMatch ? payMatch[0] : "", tasks: "", created: "", id: name });
        }
      }
    }

    console.log("[DA Alert] Scraped projects:", projects.map(p => p.name));
    return projects;
  }

  // ─── Filtering ──────────────────────────────────────────────────────
  // Filters out Refreshers, Reference Versions, and other excluded keywords.
  // Only keeps paid project notifications.

  function filterProjects(projects) {
    const keywordsStr = getSetting("keywords").trim();
    const includeKeywords = keywordsStr
      ? keywordsStr.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean)
      : [];

    const excludeStr = getSetting("excludeKeywords").trim();
    const excludeKeywords = excludeStr
      ? excludeStr.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean)
      : [];

    return projects.filter((p) => {
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
  function sendNtfyAlert(title, body, tags = "money,rocket", priority = "high") {
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
        `${newProjects.length} new projects available!`
      );
    }
  }

  // ─── Main Check Logic ──────────────────────────────────────────────
  let isChecking = false;
  let isFirstCheck = seenProjects.size === 0;

  async function checkForNewProjects(useLiveDOM = false) {
    if (!getSetting("enabled") || isChecking) return;
    isChecking = true;

    console.log("[DA Alert] Checking for new projects...");
    updateStatusUI("Checking...", "#f0ad4e");

    // useLiveDOM: scrape the current page (for initial load / manual check on projects page)
    // Otherwise: use a hidden iframe to get a fresh SPA render (for polling / off-page checks)
    let freshDoc;
    if (useLiveDOM && isOnProjectsPage()) {
      console.log("[DA Alert] Using live DOM...");
      freshDoc = getLiveDocument();
    } else {
      console.log("[DA Alert] Loading via iframe...");
      freshDoc = await getDocViaIframe();
    }

    if (!freshDoc) {
      updateStatusUI("Fetch Failed", "#d9534f");
      isChecking = false;
      return;
    }

    const allProjects = scrapeProjects(freshDoc);
    console.log(`[DA Alert] Scraped ${allProjects.length} total project(s):`, allProjects.map(p => p.name));
    const filtered = filterProjects(allProjects);
    console.log(`[DA Alert] After filtering: ${filtered.length} paid, ${allProjects.length - filtered.length} excluded`);
    console.log(`[DA Alert] Currently seen: ${seenProjects.size} project(s)`);

    const newProjects = filtered.filter((p) => !seenProjects.has(p.id));

    if (newProjects.length > 0) {
      // On first run, alert for all existing paid projects too
      if (isFirstCheck) {
        console.log(`[DA Alert] First run - found ${newProjects.length} paid project(s) on dashboard.`);
      } else {
        console.log(`[DA Alert] Found ${newProjects.length} new project(s)!`);
      }
      alertNewProjects(newProjects);
      isFirstCheck = false;

      newProjects.forEach((p) => seenProjects.add(p.id));
      pruneSeenProjects();
      GM_setValue("seenProjects", JSON.stringify([...seenProjects]));
      newThisSession += newProjects.length;
    } else {
      console.log(`[DA Alert] No new projects. (${filtered.length} tracked, ${allProjects.length - filtered.length} filtered out)`);
      isFirstCheck = false;
    }

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
      document.getElementById("da-toggle").innerHTML = panel.classList.contains("collapsed")
        ? "&#9650;"
        : "&#9660;";
    });

    document.getElementById("da-btn-settings").addEventListener("click", openSettings);
    document.getElementById("da-btn-check").addEventListener("click", () => checkForNewProjects(true));
    document.getElementById("da-btn-clear").addEventListener("click", () => {
      seenProjects.clear();
      GM_setValue("seenProjects", "[]");
      isFirstCheck = true;
      newThisSession = 0;
      updateStatusDetails(0, 0);
      console.log("[DA Alert] Cache cleared. Re-checking...");
      checkForNewProjects(true);
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
    document.getElementById("da-set-interval").value = getSetting("pollInterval");
    document.getElementById("da-set-keywords").value = getSetting("keywords");
    document.getElementById("da-set-exclude").value = getSetting("excludeKeywords");
    document.getElementById("da-set-desktop").checked = getSetting("desktopNotify");
    document.getElementById("da-set-enabled").checked = getSetting("enabled");

    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    document.getElementById("da-set-cancel").addEventListener("click", () => modal.remove());

    document.getElementById("da-set-test").addEventListener("click", () => {
      const topic = sanitizeTopic(document.getElementById("da-set-topic").value);
      if (!topic) {
        alert("Enter an ntfy topic first!");
        return;
      }
      GM_xmlhttpRequest({
        method: "POST",
        url: `https://ntfy.sh/${topic}`,
        headers: { Title: "DA Alert Test", Tags: "white_check_mark", Priority: "default" },
        data: "If you see this, notifications are working!",
        onload: () => alert("Test notification sent! Check your phone."),
        onerror: () => alert("Failed to send. Check the topic name."),
      });
    });

    document.getElementById("da-set-test-desktop").addEventListener("click", () => {
      if (typeof GM_notification === "function") {
        GM_notification({
          title: "DA Alert Test",
          text: "If you see this, desktop notifications are working!",
          timeout: 10000,
        });
        alert("Desktop notification sent! You should see it now.");
      } else if (Notification.permission === "granted") {
        new Notification("DA Alert Test", { body: "If you see this, desktop notifications are working!" });
        alert("Desktop notification sent!");
      } else {
        Notification.requestPermission().then((perm) => {
          if (perm === "granted") {
            new Notification("DA Alert Test", { body: "If you see this, desktop notifications are working!" });
            alert("Desktop notification sent!");
          } else {
            alert("Desktop notifications were denied. Please allow them in browser settings.");
          }
        });
      }
    });

    document.getElementById("da-set-save").addEventListener("click", () => {
      const interval = Math.max(300, parseInt(document.getElementById("da-set-interval").value) || 300);

      setSetting("ntfyTopic", sanitizeTopic(document.getElementById("da-set-topic").value.trim()));
      setSetting("pollInterval", interval);
      setSetting("keywords", document.getElementById("da-set-keywords").value.trim());
      setSetting("excludeKeywords", document.getElementById("da-set-exclude").value.trim());
      setSetting("desktopNotify", document.getElementById("da-set-desktop").checked);
      setSetting("enabled", document.getElementById("da-set-enabled").checked);

      const topicEl = document.getElementById("da-topic");
      if (topicEl) topicEl.textContent = getSetting("ntfyTopic") || "(not set)";

      startPolling();
      modal.remove();
      console.log("[DA Alert] Settings saved.");
    });
  }

  // ─── Polling ───────────────────────────────────────────────────────
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);

    const interval = getSetting("pollInterval") * 1000;
    pollTimer = setInterval(() => checkForNewProjects(), interval);

    console.log(`[DA Alert] Polling every ${getSetting("pollInterval")}s`);
  }

  // ─── Menu command ──────────────────────────────────────────────────
  GM_registerMenuCommand("DA Task Alert Settings", openSettings);

  // ─── Init ──────────────────────────────────────────────────────────
  function init() {
    console.log("[DA Alert] Initializing...");
    createStatusUI();

    // Initial check after delay (let SPA fully render)
    setTimeout(() => {
      checkForNewProjects(true); // use live DOM for initial check
      startPolling();
    }, 5000);
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init);
  }
})();
