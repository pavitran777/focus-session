function formatTime(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
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

function setAllowedCount(list) {
  const el = document.getElementById("allowed-count");
  const n = (list && list.length) ? list.length : 0;
  el.textContent = n === 1 ? "1 website" : `${n} websites`;
}

async function refresh() {
  const state = await getState();
  setAllowedCount(state.allowedList || []);

  const active = state.strictActive && state.endTime > Date.now();
  document.getElementById("active").classList.toggle("hidden", !active);
  document.getElementById("start").style.display = active ? "none" : "block";

  if (active) {
    const end = state.endTime;
    const total = state.totalMs || Math.max(1, end - Date.now());

    function tick() {
      const left = end - Date.now();
      const fracElapsed = (total - left) / total;

      setPopupTime(left);
      setPopupProgress(fracElapsed);

      if (left <= 0) {
        clearInterval(timer);
        refresh();
      }
    }

    tick();
    const timer = setInterval(tick, 1000);
  }
}

document.getElementById("allowed-link").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.querySelectorAll("[data-mins]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const mins = parseInt(btn.getAttribute("data-mins"), 10);
    await chrome.runtime.sendMessage({ cmd: "start", durationMs: mins * 60 * 1000 });
    window.close();
  });
});

// Delete this entire listener
// document.getElementById("stop").addEventListener("click", async () => {
//   await chrome.runtime.sendMessage({ cmd: "stop" });
//   await refresh();
// });

refresh();
