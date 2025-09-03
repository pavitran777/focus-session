function formatTime(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
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
    const countdown = document.getElementById("countdown");
    function tick() {
      const left = state.endTime - Date.now();
      countdown.textContent = formatTime(left);
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
