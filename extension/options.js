const FIELDS = ["enabled", "keepAliveMinutes", "autoLogin", "silentRelogin", "email"];

function fmtTime(ts) {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
}

function line(text, className) {
  const div = document.createElement("div");
  div.textContent = text;
  if (className) div.className = className;
  return div;
}

async function renderStatus() {
  const { status = {}, pausedByLogout } = await browser.storage.local.get(["status", "pausedByLogout"]);
  const el = document.getElementById("status");
  const [label, cls] = {
    in: ["Signed in", "ok"],
    out: ["Signed out", "bad"],
    error: ["Ping failed", "bad"],
  }[status.lastState] || ["Unknown", "muted"];
  const first = line("");
  const stateSpan = document.createElement("span");
  stateSpan.className = cls;
  stateSpan.textContent = label;
  const timeSpan = document.createElement("span");
  timeSpan.className = "muted";
  timeSpan.textContent = ` · last check ${fmtTime(status.lastPing)}`;
  first.append(stateSpan, timeSpan);
  el.replaceChildren(first);
  if (status.loggingIn) el.append(line("Logging in…"));
  if (pausedByLogout) el.append(line("Paused because you logged out. Use “Log in now” to resume.", "muted"));
  if (status.needsAttention && status.lastError) el.append(line(status.lastError, "bad"));
}

async function load() {
  const settings = await getSettings();
  for (const key of FIELDS) {
    const input = document.getElementById(key);
    if (input.type === "checkbox") input.checked = settings[key];
    else input.value = settings[key];
    input.addEventListener("change", save);
  }
  renderStatus();
}

async function save() {
  const settings = {};
  for (const key of FIELDS) {
    const input = document.getElementById(key);
    settings[key] = input.type === "checkbox" ? input.checked
      : input.type === "number" ? Math.max(1, Number(input.value) || 5)
      : input.value.trim();
  }
  await browser.storage.local.set({ settings });
}

document.getElementById("pingNow").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "pingNow" });
  renderStatus();
});
document.getElementById("loginNow").addEventListener("click", () => {
  browser.runtime.sendMessage({ type: "loginNow" });
  window.close();
});
browser.storage.onChanged.addListener((changes) => {
  if (changes.status || changes.pausedByLogout) renderStatus();
});

load();
