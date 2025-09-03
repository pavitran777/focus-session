const circumference = 2 * Math.PI * 70; // r=70 as in CSS dasharray
const progressCircle = document.getElementById("progress");
const timeLabel = document.getElementById("time");

// NEW: read previousUrl from query
const params = new URLSearchParams(location.search);
const previousUrl = params.get("previousUrl");

// NEW: trap the Back button so you stay on the blocked page during a session
function trapBack() {
  // Create a history entry, and on back, immediately push ourselves again.
  history.pushState(null, "", location.href);
  window.addEventListener("popstate", () => {
    history.pushState(null, "", location.href);
  });
}

function formatTime(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function setProgress(fracElapsed) {
  const offset = circumference * Math.min(1, Math.max(0, fracElapsed)); // shrinking ring
  progressCircle.style.strokeDashoffset = String(offset);
}

async function readState() {
  return await chrome.storage.local.get({ strictActive: false, endTime: 0, totalMs: 0 });
}

async function init() {
  document.getElementById("open-options").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // NEW: only trap back if we’re in an active session
  const state = await readState();
  if (state.strictActive && state.endTime > Date.now()) {
    trapBack();
  }

  if (!state.strictActive || !state.endTime || state.endTime <= Date.now()) {
    timeLabel.textContent = "00:00";
    setProgress(1);
    // NEW: session is over — if we know the blocked URL, go back to it
    if (previousUrl) location.replace(previousUrl);
    return;
  }

  const total = state.totalMs || Math.max(1, state.endTime - Date.now());
  function tick() {
    const left = state.endTime - Date.now();
    const frac = (total - left) / total;
    timeLabel.textContent = formatTime(left);
    setProgress(frac);

    if (left <= 0) {
      clearInterval(timer);
      timeLabel.textContent = "00:00";
      setProgress(1);
      // NEW: timer done — return to the original URL
      if (previousUrl) location.replace(previousUrl);
    }
  }
  tick();
  const timer = setInterval(tick, 1000);
}

init();
