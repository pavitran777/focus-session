const ALLOWED_DEFAULT = ["chatgpt.com", "google.com", "youtube.com", "chat.openai.com"];
const BLOCKED_DEFAULT = [];
const SESSION_MODE_ALLOW = "allow";
const SESSION_MODE_BLOCKED = "blocked";
const DONATE_URL = "https://buymeacoffee.com/devitzo";
const LIST_CONFIG = {
  [SESSION_MODE_ALLOW]: {
    storageKey: "allowedList",
    title: "Allow List",
    subtitle: "Add the sites you want available during a Strict Session.",
    placeholder: "e.g. chatgpt.com",
    empty: "No allowed websites yet. Add some above.",
    clearLabel: "Clear Allow List",
    clearConfirm: "Are you sure you want to clear the Allow List? During a Strict Session, all websites will be blocked until you add sites back."
  },
  [SESSION_MODE_BLOCKED]: {
    storageKey: "blockedList",
    title: "Blocked List",
    subtitle: "Add the sites you want blocked during a Strict Session.",
    placeholder: "e.g. reddit.com",
    empty: "No blocked websites yet. Add some above.",
    clearLabel: "Clear Blocked List",
    clearConfirm: "Are you sure you want to clear the Blocked List? No sites will be blocked until you add some back."
  }
};

let activeTab = SESSION_MODE_ALLOW;
let blockedListVisible = false;
let listsState = {
  [SESSION_MODE_ALLOW]: [],
  [SESSION_MODE_BLOCKED]: []
};

function normalizeDomain(d) {
  if (!d) return "";
  try {
    d = d.trim();
    if (!d) return "";
    d = d.replace(/^https?:\/\//i, "");
    d = d.split("/")[0];
    d = d.replace(/^www\./i, "");
    return d;
  } catch (e) {
    return d;
  }
}

async function loadLists() {
  const st = await chrome.storage.local.get({
    allowedList: ALLOWED_DEFAULT,
    blockedList: BLOCKED_DEFAULT
  });

  listsState[SESSION_MODE_ALLOW] = Array.isArray(st.allowedList) ? [...st.allowedList] : [...ALLOWED_DEFAULT];
  listsState[SESSION_MODE_BLOCKED] = Array.isArray(st.blockedList) ? [...st.blockedList] : [...BLOCKED_DEFAULT];
}

async function saveList(mode, list) {
  await chrome.storage.local.set({ [LIST_CONFIG[mode].storageKey]: list });
  // Sync rules immediately when a session is running.
  await chrome.runtime.sendMessage({ cmd: "reapplyRules" }).catch(() => { });
}

function getActiveList() {
  return listsState[activeTab];
}

function updateMaskedState() {
  const visibilityBtn = document.getElementById("visibilityBtn");
  const listWrap = document.getElementById("listWrap");
  const listMask = document.getElementById("listMask");
  const isBlockedTab = activeTab === SESSION_MODE_BLOCKED;
  const isHidden = isBlockedTab && !blockedListVisible;

  visibilityBtn.classList.toggle("hidden-control", !isBlockedTab);
  visibilityBtn.classList.toggle("is-active", isBlockedTab && blockedListVisible);
  visibilityBtn.setAttribute("aria-label", blockedListVisible ? "Hide blocked list" : "Show blocked list");
  visibilityBtn.setAttribute("title", blockedListVisible ? "Hide blocked list" : "Show blocked list");
  listWrap.classList.toggle("masked", isHidden);
  listMask.classList.toggle("hidden", !isHidden);
}

function render(list) {
  const ul = document.getElementById("list");
  ul.innerHTML = "";
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = LIST_CONFIG[activeTab].empty;
    ul.appendChild(li);
    updateMaskedState();
    return;
  }
  list.forEach((domain, idx) => {
    const li = document.createElement("li");
    const d = document.createElement("div");
    d.className = "domain";
    d.textContent = domain;
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      list.splice(idx, 1);
      await saveList(activeTab, list);
      render(list);
    });
    li.appendChild(d);
    li.appendChild(remove);
    ul.appendChild(li);
  });
  updateMaskedState();
}

function updateView() {
  const config = LIST_CONFIG[activeTab];

  document.getElementById("subtitle").textContent = config.subtitle;
  document.getElementById("domain").placeholder = config.placeholder;
  document.getElementById("clearAll").textContent = config.clearLabel;

  document.querySelectorAll("[data-tab]").forEach((tab) => {
    const isActive = tab.dataset.tab === activeTab;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  render(getActiveList());
}

document.getElementById("add").addEventListener("click", async () => {
  const input = document.getElementById("domain");
  const raw = input.value;
  const d = normalizeDomain(raw);
  if (!d) return;
  const list = getActiveList();
  if (!list.includes(d)) list.push(d);
  await saveList(activeTab, list);
  input.value = "";
  render(list);
});

document.getElementById("domain").addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    document.getElementById("add").click();
  }
});

/* ---- Minimal settings menu logic ---- */
const settingsBtn = document.getElementById("settingsBtn");
const settingsMenu = document.getElementById("settingsMenu");
const clearAllBtn = document.getElementById("clearAll");
const donateBtn = document.getElementById("donate");
const visibilityBtn = document.getElementById("visibilityBtn");

function closeMenu() {
  settingsMenu.classList.add("hidden");
}

settingsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  settingsMenu.classList.toggle("hidden");
});

settingsMenu.addEventListener("click", (e) => e.stopPropagation());

document.addEventListener("click", () => closeMenu());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});

clearAllBtn.addEventListener("click", async () => {
  const confirmed = window.confirm(LIST_CONFIG[activeTab].clearConfirm);
  if (!confirmed) return;
  listsState[activeTab] = [];
  await saveList(activeTab, []);
  render([]);
  closeMenu();
});

donateBtn.addEventListener("click", () => {
  window.open(DONATE_URL, "_blank", "noopener,noreferrer");
  closeMenu();
});

visibilityBtn.addEventListener("click", () => {
  blockedListVisible = !blockedListVisible;
  updateMaskedState();
});

document.querySelectorAll("[data-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    activeTab = tab.dataset.tab === SESSION_MODE_BLOCKED ? SESSION_MODE_BLOCKED : SESSION_MODE_ALLOW;
    closeMenu();
    updateView();
  });
});

(async () => {
  await loadLists();
  updateView();
})();
