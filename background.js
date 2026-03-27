const ALL_RULE_ID = 1;
const ALLOW_BASE_ID = 1000;
const ALLOWED_DEFAULT = ["chatgpt.com", "google.com", "youtube.com", "chat.openai.com"];
const ALARM_NAME = "strict-session-end";
const DEFAULT_ACTION_TITLE = "Strict Session";
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
    allowedList: ALLOWED_DEFAULT
  });
  return data;
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

function getEffectiveAllowedList(allowedList) {
  const sourceList = Array.isArray(allowedList) ? allowedList : ALLOWED_DEFAULT;
  return sourceList.map(normalizeDomain).filter(Boolean);
}

function isSessionActive(state) {
  return Boolean(state && state.strictActive && state.endTime > Date.now());
}

async function applyRules(allowedList) {
  allowedList = getEffectiveAllowedList(allowedList);

  const blockedUrl = chrome.runtime.getURL("blocked/blocked.html");
  // Use a regex rule so we can substitute the original URL into the query param
  const redirectAllRule = {
    id: ALL_RULE_ID,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        regexSubstitution: `${blockedUrl}?previousUrl=\\0`
      }
    },
    condition: {
      regexFilter: "^(https?|file)://.*",
      resourceTypes: ["main_frame"]
    }
  };

  const addRules = [redirectAllRule];

  allowedList.forEach((domain, idx) => {
    const rule = {
      id: ALLOW_BASE_ID + idx,
      priority: 2,
      action: { type: "allow" },
      condition: {
        urlFilter: "||" + domain + "^",
        resourceTypes: ["main_frame"]
      }
    };
    addRules.push(rule);
  });

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = existing.map(r => r.id);
  await chrome.declarativeNetRequest.updateDynamicRules({ addRules, removeRuleIds: removeIds });
}

async function clearRules() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  if (existing.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [], removeRuleIds: existing.map(r => r.id) });
  }
}

async function startSession(durationMs) {
  const now = Date.now();
  const endTime = now + durationMs;
  const { allowedList } = await getState();
  await chrome.storage.local.set({ strictActive: true, endTime, totalMs: durationMs });
  await applyRules(allowedList);
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
  const st = await getState();
  if (!st.allowedList) {
    await chrome.storage.local.set({ allowedList: ALLOWED_DEFAULT });
  }
  await ensureState();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureState();
});

async function ensureState() {
  const state = await getState();
  if (isSessionActive(state)) {
    await applyRules(state.allowedList);
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
        await applyRules(st.allowedList);
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

void syncActionAppearance();
