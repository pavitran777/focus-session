const circumference = 2 * Math.PI * 70; // r=70 as in CSS dasharray
const progressCircle = document.getElementById("progress");
const timeLabel = document.getElementById("time");

function formatTime(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function setProgress(fracElapsed) {
  // 0 = just started (full ring), 1 = finished (empty ring)
  const offset = circumference * fracElapsed;      // was: circumference * (1 - frac)
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

  const state = await readState();

  if (!state.strictActive || !state.endTime || state.endTime <= Date.now()) {
    timeLabel.textContent = "00:00";
    setProgress(1);
    return;
  }

  const total = state.totalMs || Math.max(1, state.endTime - Date.now());
  function tick() {
    const left = state.endTime - Date.now();
    const frac = Math.min(1, Math.max(0, (total - left) / total));
    timeLabel.textContent = formatTime(left);
    setProgress(frac);

    if (left <= 0) {
      clearInterval(timer);
      timeLabel.textContent = "00:00";
      setProgress(1);
    }
  }
  tick();
  const timer = setInterval(tick, 1000);
}

init();
