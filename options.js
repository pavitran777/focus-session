
const ALLOWED_DEFAULT = ["chatgpt.com", "google.com", "youtube.com", "chat.openai.com"];

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

async function loadList() {
  const st = await chrome.storage.local.get({ allowedList: ALLOWED_DEFAULT });
  return st.allowedList || [];
}

async function saveList(list) {
  await chrome.storage.local.set({ allowedList: list });
  // If session is active, re-apply rules immediately
  await chrome.runtime.sendMessage({ cmd: "reapplyRules" }).catch(()=>{});
}

function render(list) {
  const ul = document.getElementById("list");
  ul.innerHTML = "";
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No websites yet. Add some above.";
    ul.appendChild(li);
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
      await saveList(list);
      render(list);
    });
    li.appendChild(d);
    li.appendChild(remove);
    ul.appendChild(li);
  });
}

document.getElementById("add").addEventListener("click", async () => {
  const input = document.getElementById("domain");
  const raw = input.value;
  const d = normalizeDomain(raw);
  if (!d) return;
  const list = await loadList();
  if (!list.includes(d)) list.push(d);
  await saveList(list);
  input.value = "";
  render(list);
});

document.getElementById("domain").addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    document.getElementById("add").click();
  }
});

(async () => {
  const list = await loadList();
  render(list);
})();
