const ALL_RULE_ID = 1;
const ALLOW_BASE_ID = 1000;
const BLOCK_BASE_ID = 2000;
const ALLOWED_DEFAULT = ["chatgpt.com", "google.com", "youtube.com", "chat.openai.com", "claude.ai"];
const BLOCKED_DEFAULT = [];
const SESSION_MODE_ALLOW = "allow";
const SESSION_MODE_BLOCKED = "blocked";
const ALARM_NAME = "strict-session-end";
const DEFAULT_ACTION_TITLE = "Strict Focus";
const ACTION_ICON_PATHS = {
  16: "icons/icon16.png",
  32: "icons/icon32.png",
  48: "icons/icon48.png",
  128: "icons/icon128.png"
};

// Action updater functions
let badgeTimer = null;

function formatActionTitle(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  const parts = [];

  if (h > 0) {
    parts.push(`${h}h`);
  }

  if (mm > 0 || h > 0) {
    parts.push(`${mm}m`);
  }

  if (h === 0 && (ss > 0 || parts.length === 0)) {
    parts.push(`${ss}s`);
  }

  return `${DEFAULT_ACTION_TITLE} | ${parts.join(" ")} left`;
}

function formatCompactBadge(totalSec) {
  if (totalSec <= 0) return "";
  if (totalSec < 60) return `${totalSec}s`;
  return `${Math.ceil(totalSec / 60)}m`;
}

async function setBaseActionIcon() {
  await chrome.action.setIcon({ path: ACTION_ICON_PATHS });
}

async function setActiveActionAppearance(totalSec) {
  try {
    await setBaseActionIcon();
    await chrome.action.setBadgeBackgroundColor({ color: "#111" });
    await chrome.action.setBadgeTextColor?.({ color: "#fff" });
    await chrome.action.setBadgeText({ text: formatCompactBadge(totalSec) });
    await chrome.action.setTitle({ title: formatActionTitle(totalSec) });
  } catch { }
}

async function setInactiveActionAppearance() {
  try {
    await setBaseActionIcon();
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: DEFAULT_ACTION_TITLE });
  } catch { }
}

async function updateBadgeOnce() {
  const { strictActive, endTime } = await getState();
  if (!strictActive || !endTime || endTime <= Date.now()) {
    await setInactiveActionAppearance();
    return false;
  }

  const left = endTime - Date.now(); // ms
  const totalSec = Math.max(0, Math.floor(left / 1000));

  await setActiveActionAppearance(totalSec);
  return true;
}

function startBadgeUpdater() {
  if (badgeTimer) clearInterval(badgeTimer);
  // Update every second; if the service worker sleeps, it'll catch up on next wake.
  badgeTimer = setInterval(updateBadgeOnce, 1000);
  void updateBadgeOnce();
}

function stopBadgeUpdater() {
  if (badgeTimer) {
    clearInterval(badgeTimer);
    badgeTimer = null;
  }
}

async function getState() {
  const data = await chrome.storage.local.get({
    strictActive: false,
    endTime: 0,
    totalMs: 0,
    allowedList: ALLOWED_DEFAULT,
    blockedList: BLOCKED_DEFAULT,
    sessionMode: SESSION_MODE_ALLOW
  });

  return {
    ...data,
    allowedList: getEffectiveList(data.allowedList, ALLOWED_DEFAULT),
    blockedList: getEffectiveList(data.blockedList, BLOCKED_DEFAULT),
    sessionMode: normalizeSessionMode(data.sessionMode)
  };
}

async function getLiveState() {
  const state = await getState();
  if (state.strictActive && state.endTime && state.endTime <= Date.now()) {
    // The blocked page can notice expiry before the alarm handler runs.
    await stopSession();
    return await getState();
  }
  return state;
}

function normalizeDomain(d) {
  if (!d) return "";
  try {
    d = d.trim();
    if (!d) return "";
    // Strip protocol & path
    d = d.replace(/^https?:\/\//i, "");
    d = d.split("/")[0];
    d = d.replace(/^www\./i, "");
    return d;
  } catch (e) {
    return d;
  }
}

function getEffectiveList(list, fallback) {
  const sourceList = Array.isArray(list) ? list : fallback;
  return sourceList.map(normalizeDomain).filter(Boolean);
}

function normalizeSessionMode(mode) {
  return mode === SESSION_MODE_BLOCKED ? SESSION_MODE_BLOCKED : SESSION_MODE_ALLOW;
}

function isSessionActive(state) {
  return Boolean(state && state.strictActive && state.endTime > Date.now());
}

function getDynamicRuleBlockedUrl() {
  const blockedUrl = chrome.runtime.getURL("blocked/blocked.html");
  return `${blockedUrl}?previousUrl=\\0`;
}

function getBlockedPageUrl(previousUrl) {
  const blockedUrl = chrome.runtime.getURL("blocked/blocked.html");
  return previousUrl
    ? `${blockedUrl}?previousUrl=${encodeURIComponent(previousUrl)}`
    : blockedUrl;
}

function isBlockedPageUrl(url) {
  return Boolean(url && url.startsWith(chrome.runtime.getURL("blocked/blocked.html")));
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(url);
}

function isFileUrl(url) {
  return /^file:\/\//i.test(url);
}

function getUrlHostname(url) {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return "";
  }
}

function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function listContainsHostname(list, hostname) {
  return list.some((domain) => matchesDomain(hostname, domain));
}

function shouldBlockUrl(url, state) {
  if (!isSessionActive(state) || !url || isBlockedPageUrl(url)) {
    return false;
  }

  const mode = normalizeSessionMode(state.sessionMode);

  if (isFileUrl(url)) {
    return mode === SESSION_MODE_ALLOW;
  }

  if (!isHttpUrl(url)) {
    return false;
  }

  const hostname = getUrlHostname(url);
  if (!hostname) {
    return false;
  }

  return mode === SESSION_MODE_BLOCKED
    ? listContainsHostname(state.blockedList, hostname)
    : !listContainsHostname(state.allowedList, hostname);
}

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createRedirectAction() {
  return {
    type: "redirect",
    redirect: {
      regexSubstitution: getDynamicRuleBlockedUrl()
    }
  };
}

function buildAllowRules(allowedList) {
  const redirectAllRule = {
    id: ALL_RULE_ID,
    priority: 1,
    action: createRedirectAction(),
    condition: {
      regexFilter: "^(https?|file)://.*",
      resourceTypes: ["main_frame"]
    }
  };

  const rules = [redirectAllRule];

  allowedList.forEach((domain, idx) => {
    rules.push({
      id: ALLOW_BASE_ID + idx,
      priority: 2,
      action: { type: "allow" },
      condition: {
        urlFilter: "||" + domain + "^",
        resourceTypes: ["main_frame"]
      }
    });
  });

  return rules;
}

function buildBlockedRules(blockedList) {
  return blockedList.map((domain, idx) => ({
    id: BLOCK_BASE_ID + idx,
    priority: 1,
    action: createRedirectAction(),
    condition: {
      regexFilter: `^https?://([^/]+\\.)?${escapeForRegex(domain)}([/?#:].*)?$`,
      resourceTypes: ["main_frame"]
    }
  }));
}

async function applyRules(sessionMode, allowedList, blockedList) {
  const normalizedMode = normalizeSessionMode(sessionMode);
  const effectiveAllowedList = getEffectiveList(allowedList, ALLOWED_DEFAULT);
  const effectiveBlockedList = getEffectiveList(blockedList, BLOCKED_DEFAULT);
  const addRules =
    normalizedMode === SESSION_MODE_BLOCKED
      ? buildBlockedRules(effectiveBlockedList)
      : buildAllowRules(effectiveAllowedList);

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = existing.map((rule) => rule.id);
  await chrome.declarativeNetRequest.updateDynamicRules({ addRules, removeRuleIds: removeIds });
}

async function clearRules() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  if (existing.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [], removeRuleIds: existing.map(r => r.id) });
  }
}

async function enforceTab(tabId, url, state = null) {
  if (typeof tabId !== "number" || !url) {
    return false;
  }

  const activeState = state || await getLiveState();
  if (!shouldBlockUrl(url, activeState)) {
    return false;
  }

  await chrome.tabs.update(tabId, { url: getBlockedPageUrl(url) });
  return true;
}

async function startSession(durationMs) {
  const now = Date.now();
  const endTime = now + durationMs;
  const state = await getState();
  const sessionMode = normalizeSessionMode(state.sessionMode);
  await chrome.storage.local.set({ strictActive: true, endTime, totalMs: durationMs, sessionMode });
  await applyRules(sessionMode, state.allowedList, state.blockedList);
  await chrome.alarms.create(ALARM_NAME, { when: endTime });
  startBadgeUpdater();
}

async function stopSession() {
  await chrome.storage.local.set({ strictActive: false, endTime: 0, totalMs: 0 });
  await chrome.alarms.clear(ALARM_NAME);
  await clearRules();
  stopBadgeUpdater();
  await setInactiveActionAppearance();
}

chrome.runtime.onInstalled.addListener(async () => {
  const st = await chrome.storage.local.get(["allowedList", "blockedList", "sessionMode"]);
  const updates = {};

  if (!Array.isArray(st.allowedList)) {
    updates.allowedList = ALLOWED_DEFAULT;
  }

  if (!Array.isArray(st.blockedList)) {
    updates.blockedList = BLOCKED_DEFAULT;
  }

  if (!st.sessionMode) {
    updates.sessionMode = SESSION_MODE_ALLOW;
  }

  if (Object.keys(updates).length) {
    await chrome.storage.local.set(updates);
  }

  await ensureState();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureState();
});

async function ensureState() {
  const state = await getState();
  if (isSessionActive(state)) {
    await applyRules(state.sessionMode, state.allowedList, state.blockedList);
    await chrome.alarms.create(ALARM_NAME, { when: state.endTime });
    startBadgeUpdater();
  } else {
    await stopSession();
  }
}

async function syncActionAppearance() {
  const state = await getLiveState();
  if (isSessionActive(state)) {
    startBadgeUpdater();
  } else {
    stopBadgeUpdater();
    await setInactiveActionAppearance();
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await stopSession();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg && msg.cmd === "start") {
      const sessionMode = normalizeSessionMode(msg.sessionMode);
      await chrome.storage.local.set({ sessionMode });
      await startSession(msg.durationMs);
      sendResponse({ ok: true });
    } else if (msg && msg.cmd === "stop") {
      await stopSession();
      sendResponse({ ok: true });
    } else if (msg && msg.cmd === "getState") {
      const st = await getLiveState();
      sendResponse(st);
    } else if (msg && msg.cmd === "reapplyRules") {
      const st = await getLiveState();
      if (isSessionActive(st)) {
        await applyRules(st.sessionMode, st.allowedList, st.blockedList);
      } else {
        await clearRules();
      }
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false });
    }
  })();
  return true; // keep message channel open for async response
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "loading") {
    return;
  }

  const nextUrl = changeInfo.url || tab.pendingUrl || tab.url;
  if (!nextUrl) {
    return;
  }

  void enforceTab(tabId, nextUrl);
});

chrome.tabs.onReplaced.addListener(async (addedTabId) => {
  try {
    const tab = await chrome.tabs.get(addedTabId);
    void enforceTab(addedTabId, tab.pendingUrl || tab.url);
  } catch { }
});

void syncActionAppearance();
