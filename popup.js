const SESSION_MODE_ALLOW = "allow";
const SESSION_MODE_BLOCKED = "blocked";
let popupTimer = null;

function normalizeSessionMode(mode) {
  return mode === SESSION_MODE_BLOCKED ? SESSION_MODE_BLOCKED : SESSION_MODE_ALLOW;
}

function formatTime(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Added popup ring helpers (same geometry as blocked.js: r = 70)
const POPUP_CIRC = 2 * Math.PI * 70;
function setPopupProgress(fracElapsed) {
  // Shrinking ring: 0 → full, 1 → empty
  const offset = POPUP_CIRC * Math.min(1, Math.max(0, fracElapsed));
  const ring = document.getElementById("progress");
  if (ring) ring.style.strokeDashoffset = String(offset);
}

function setPopupTime(ms) {
  const t = document.getElementById("time");
  if (t) t.textContent = formatTime(ms);
}

async function getState() {
  return await chrome.runtime.sendMessage({ cmd: "getState" });
}

function getModeLabel(mode) {
  return normalizeSessionMode(mode) === SESSION_MODE_BLOCKED
    ? "Block Only"
    : "Allow Only";
}

function getModeCopy(mode) {
  return normalizeSessionMode(mode) === SESSION_MODE_BLOCKED
    ? "Only sites on your Block List are blocked during this session"
    : "Only sites on your Allow List stay available during this session";
}

function setListSummary(state) {
  const el = document.getElementById("list-summary");
  const allowedCount = Array.isArray(state.allowedList) ? state.allowedList.length : 0;
  const blockedCount = Array.isArray(state.blockedList) ? state.blockedList.length : 0;
  el.textContent = `Allow ${allowedCount} · Block ${blockedCount}`;
}

function setModeSelection(mode) {
  const normalizedMode = normalizeSessionMode(mode);
  document.body.dataset.mode = normalizedMode;
  document.querySelectorAll("[data-mode]").forEach((button) => {
    const isActive = button.dataset.mode === normalizedMode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-checked", String(isActive));
  });
  document.getElementById("mode-copy").textContent = getModeCopy(normalizedMode);
}

function setActiveMode(mode) {
  const label = getModeLabel(mode);
  document.body.dataset.mode = normalizeSessionMode(mode);
  document.getElementById("active-mode-label").textContent = label;
  document.getElementById("active-mode-copy").textContent = getModeCopy(mode);
}

function clearPopupTimer() {
  if (popupTimer) {
    clearInterval(popupTimer);
    popupTimer = null;
  }
}

async function refresh() {
  clearPopupTimer();
  const state = await getState();
  setListSummary(state);
  setModeSelection(state.sessionMode);

  const active = state.strictActive && state.endTime > Date.now();
  document.getElementById("active").classList.toggle("hidden", !active);
  document.getElementById("start").style.display = active ? "none" : "block";

  if (active) {
    setActiveMode(state.sessionMode);
    const end = state.endTime;
    const total = state.totalMs || Math.max(1, end - Date.now());

    function tick() {
      const left = end - Date.now();
      const fracElapsed = (total - left) / total;

      setPopupTime(left);
      setPopupProgress(fracElapsed);

      if (left <= 0) {
        clearPopupTimer();
        void refresh();
      }
    }

    tick();
    popupTimer = setInterval(tick, 1000);
  }
}

document.getElementById("lists-link").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", async () => {
    const sessionMode = normalizeSessionMode(button.dataset.mode);
    await chrome.storage.local.set({ sessionMode });
    setModeSelection(sessionMode);
  });
});

document.querySelectorAll("[data-mins]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const mins = parseInt(btn.getAttribute("data-mins"), 10);
    const { sessionMode = SESSION_MODE_ALLOW } = await chrome.storage.local.get({ sessionMode: SESSION_MODE_ALLOW });
    await chrome.runtime.sendMessage({
      cmd: "start",
      durationMs: mins * 60 * 1000,
      sessionMode: normalizeSessionMode(sessionMode)
    });
    window.close();
  });
});

// Delete this entire listener
// document.getElementById("stop").addEventListener("click", async () => {
//   await chrome.runtime.sendMessage({ cmd: "stop" });
//   await refresh();
// });

refresh();
