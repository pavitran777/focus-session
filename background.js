
const ALL_RULE_ID = 1;
const ALLOW_BASE_ID = 1000;
const ALLOWED_DEFAULT = ["chatgpt.com", "google.com", "youtube.com"];
const ALARM_NAME = "strict-session-end";

async function getState() {
  const data = await chrome.storage.local.get({
    strictActive: false,
    endTime: 0,
    totalMs: 0,
    allowedList: ALLOWED_DEFAULT
  });
  return data;
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

async function applyRules(allowedList) {
  allowedList = (allowedList && allowedList.length ? allowedList : ALLOWED_DEFAULT).map(normalizeDomain);

  const redirectAllRule = {
    id: ALL_RULE_ID,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { extensionPath: "/blocked/blocked.html" }
    },
    condition: {
      regexFilter: "^(http|https)://.*",
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
  try {
    await chrome.action.setBadgeText({ text: "ON" });
  } catch (e) {}
}

async function stopSession() {
  await chrome.storage.local.set({ strictActive: false, endTime: 0, totalMs: 0 });
  await chrome.alarms.clear(ALARM_NAME);
  await clearRules();
  try {
    await chrome.action.setBadgeText({ text: "" });
  } catch (e) {}
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
  const { strictActive, endTime, allowedList } = await getState();
  if (strictActive && endTime > Date.now()) {
    await applyRules(allowedList);
    await chrome.alarms.create(ALARM_NAME, { when: endTime });
    try { await chrome.action.setBadgeText({ text: "ON" }); } catch (e) {}
  } else {
    await stopSession();
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
      const st = await getState();
      sendResponse(st);
    } else if (msg && msg.cmd === "reapplyRules") {
      const st = await getState();
      await applyRules(st.allowedList);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false });
    }
  })();
  return true; // keep message channel open for async response
});
