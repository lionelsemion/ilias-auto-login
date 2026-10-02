// Background: periodic keep-alive pings, silent re-login, shared login-flow state.

const ALARM = "ilias-keepalive";
const SILENT_TIMEOUT_ALARM = "ilias-silent-timeout";
const SILENT_TIMEOUT_MINUTES = 1.5;
// A login flow started by the extension is considered "fresh" for this long.
const FLOW_TTL_MS = 5 * 60 * 1000;

async function setStatus(patch) {
  const { status } = await browser.storage.local.get("status");
  const next = Object.assign({}, status, patch);
  await browser.storage.local.set({ status: next });
  updateBadge(next);
}

function updateBadge(status) {
  let text = "";
  let color = "#3a7d44";
  if (status.needsAttention) {
    text = "!";
    color = "#c0392b";
  } else if (status.loggingIn) {
    text = "…";
    color = "#d68910";
  }
  browser.action.setBadgeText({ text });
  browser.action.setBadgeBackgroundColor({ color });
}

async function scheduleAlarm() {
  const settings = await getSettings();
  await browser.alarms.clear(ALARM);
  if (settings.enabled) {
    browser.alarms.create(ALARM, {
      delayInMinutes: 0.1,
      periodInMinutes: Math.max(1, Number(settings.keepAliveMinutes) || 5),
    });
  }
}

async function ping() {
  let state = "unknown";
  try {
    const res = await fetch(PING_URL, { credentials: "include", cache: "no-store" });
    const html = await res.text();
    state = iliasLoginState(res.url, html);
  } catch (e) {
    await setStatus({ lastPing: Date.now(), lastState: "error", lastError: String(e) });
    return;
  }
  await setStatus({ lastPing: Date.now(), lastState: state, lastError: null });

  if (state === "out") await maybeSilentRelogin();
}

async function maybeSilentRelogin() {
  const settings = await getSettings();
  const { pausedByLogout } = await browser.storage.local.get("pausedByLogout");
  if (!settings.enabled || !settings.autoLogin || !settings.silentRelogin || pausedByLogout) return;
  const { silentTabId } = await browser.storage.local.get("silentTabId");
  if (silentTabId != null) return;

  // Only re-login in the background while the user actually has ILIAS open;
  // otherwise the content script logs in lazily on the next visit.
  const iliasTabs = await browser.tabs.query({ url: ILIAS_ORIGIN + "/*" });
  if (iliasTabs.length === 0) return;

  await markFlowStarted();
  const tab = await browser.tabs.create({ url: shibLoginUrl(), active: false });
  await browser.storage.local.set({ silentTabId: tab.id });
  await setStatus({ loggingIn: true });
  browser.alarms.create(SILENT_TIMEOUT_ALARM, { delayInMinutes: SILENT_TIMEOUT_MINUTES });
}

async function onSilentTimeout() {
  // Stuck (password not autofilled, MFA, error page...). Leave the tab for the user.
  const { silentTabId } = await browser.storage.local.get("silentTabId");
  if (silentTabId == null) return;
  await browser.storage.local.set({ silentTabId: null });
  await setStatus({ loggingIn: false, needsAttention: true, lastError: "Background re-login did not finish; see the open edu-ID tab." });
}

// What closing the browser does for this login: drop the session-only cookies of
// edu-ID (the SSO session) and ILIAS. Persistent cookies (language, trusted
// device, ...) survive a browser restart too, so they are kept.
async function clearSessionCookies() {
  let removed = 0;
  try {
    for (const domain of SESSION_COOKIE_DOMAINS) {
      let cookies;
      try {
        // firstPartyDomain: null also matches cookies when first-party isolation is on.
        cookies = await browser.cookies.getAll({ domain, firstPartyDomain: null });
      } catch (e) {
        cookies = await browser.cookies.getAll({ domain });
      }
      for (const c of cookies) {
        if (!c.session) continue;
        const details = {
          url: "https://" + c.domain.replace(/^\./, "") + c.path,
          name: c.name,
          storeId: c.storeId,
        };
        if (c.firstPartyDomain) details.firstPartyDomain = c.firstPartyDomain;
        if (c.partitionKey) details.partitionKey = c.partitionKey;
        if (await browser.cookies.remove(details)) removed++;
      }
    }
    return { ok: true, removed };
  } catch (e) {
    console.error("Clearing session cookies failed", e);
    return { ok: false, error: String(e) };
  }
}

async function markFlowStarted() {
  await browser.storage.local.set({ flow: { startedAt: Date.now(), emailSubmitted: false, passwordSubmitted: false } });
}

async function onLoggedIn(tabId) {
  await browser.storage.local.set({ flow: null, pausedByLogout: false });
  await setStatus({ loggingIn: false, needsAttention: false, lastState: "in", lastPing: Date.now() });
  const { silentTabId } = await browser.storage.local.get("silentTabId");
  if (silentTabId != null && tabId === silentTabId) {
    browser.alarms.clear(SILENT_TIMEOUT_ALARM);
    await browser.storage.local.set({ silentTabId: null });
    browser.tabs.remove(tabId).catch(() => {});
  }
}

// First URL of each tab's current ILIAS navigation, before server redirects.
// Without a session ILIAS redirects e.g. a course page to its public parent
// category, so the content script only sees where the redirects ended.
// Redirect hops keep the same requestId, so only a new requestId starts a new entry.
const navStarts = new Map();

browser.webRequest.onBeforeRequest.addListener((details) => {
  if (details.tabId < 0) return;
  const current = navStarts.get(details.tabId);
  if (!current || current.requestId !== details.requestId) {
    navStarts.set(details.tabId, { requestId: details.requestId, url: details.url });
  }
}, { urls: [ILIAS_ORIGIN + "/*"], types: ["main_frame"] });

browser.runtime.onMessage.addListener(async (msg, sender) => {
  const tabId = sender.tab ? sender.tab.id : null;
  switch (msg.type) {
    case "loggedIn":
      await onLoggedIn(tabId);
      return;
    case "loginStarted":
      await markFlowStarted();
      await setStatus({ loggingIn: true });
      return;
    case "logoutClicked":
      // Let ILIAS finish its logout with the session still intact, then clear
      // the SSO cookies even if the final logout page isn't recognised.
      await browser.storage.local.set({ pausedByLogout: true, flow: null });
      await setStatus({ loggingIn: false });
      setTimeout(clearSessionCookies, 5000);
      return;
    case "userLoggedOut":
      await browser.storage.local.set({ pausedByLogout: true, flow: null });
      await setStatus({ loggingIn: false, needsAttention: false, lastState: "out" });
      return clearSessionCookies();
    case "loginFailed":
      await browser.storage.local.set({ flow: null });
      await setStatus({ loggingIn: false, needsAttention: true, lastError: msg.reason });
      return;
    case "getFlow": {
      const { flow } = await browser.storage.local.get("flow");
      if (!flow || Date.now() - flow.startedAt > FLOW_TTL_MS) return null;
      return flow;
    }
    case "updateFlow": {
      const { flow } = await browser.storage.local.get("flow");
      if (flow) await browser.storage.local.set({ flow: Object.assign(flow, msg.patch) });
      return;
    }
    case "getOriginalUrl": {
      const start = navStarts.get(tabId);
      return start ? start.url : null;
    }
    case "pingNow":
      await ping();
      return (await browser.storage.local.get("status")).status;
    case "loginNow":
      await browser.storage.local.set({ pausedByLogout: false });
      await markFlowStarted();
      await browser.tabs.create({ url: shibLoginUrl() });
      return;
  }
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) ping();
  if (alarm.name === SILENT_TIMEOUT_ALARM) onSilentTimeout();
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  navStarts.delete(tabId);
  const { silentTabId } = await browser.storage.local.get("silentTabId");
  if (tabId === silentTabId) await browser.storage.local.set({ silentTabId: null });
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) scheduleAlarm();
});

browser.runtime.onInstalled.addListener(scheduleAlarm);
browser.runtime.onStartup.addListener(async () => {
  await browser.storage.local.set({ silentTabId: null, flow: null });
  await setStatus({ loggingIn: false });
  scheduleAlarm();
});
browser.storage.local.get("status").then(({ status }) => updateBadge(status || {}));
