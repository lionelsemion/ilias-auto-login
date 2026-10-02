// Runs on ilias.unibe.ch pages: detects logged-out state and starts the edu-ID login,
// then returns the tab to the page the user was on. Also detects deliberate logouts.

(async () => {
  const RETURN_KEY = "iliasStaySignedIn.returnUrl";
  const ATTEMPTS_KEY = "iliasStaySignedIn.attempts";
  const MAX_ATTEMPTS = 3;
  const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

  // Logout links/buttons in the ILIAS user menu, whatever their exact URL.
  const LOGOUT_HREF = /logout|cmd=doLogout/i;
  // The "close your browser to finish logging out" notice (EN/DE/FR).
  const LOGOUT_TEXT = /close your (internet )?browser|one more step to log ?off|browser (komplett |vollständig )?(schliessen|schließen)|fermez votre navigateur/i;

  const path = location.pathname;
  const params = new URLSearchParams(location.search);

  // Catch the click before ILIAS navigates away, so the following pages
  // (which show us as logged out) don't trigger a re-login.
  document.addEventListener("click", (e) => {
    const el = e.target.closest && e.target.closest("a[href], [data-action]");
    const target = el && (el.getAttribute("href") || el.getAttribute("data-action") || "");
    if (target && LOGOUT_HREF.test(target)) {
      browser.storage.local.set({ pausedByLogout: true });
      browser.runtime.sendMessage({ type: "logoutClicked" });
    }
  }, true);

  const state = iliasLoginState(location.href, document.documentElement.outerHTML);

  // The text check only applies to logged-out pages, so a forum post quoting
  // the notice can't log anyone out.
  const isLogoutPage =
    path.startsWith("/Shibboleth.sso/Logout") ||
    /logout/i.test(params.get("cmd") || "") ||
    (state === "out" && LOGOUT_TEXT.test(document.body ? document.body.innerText : ""));
  if (isLogoutPage) {
    // Do what closing the browser would do: drop the edu-ID SSO session cookies.
    const result = await browser.runtime.sendMessage({ type: "userLoggedOut" });
    showLogoutNotice(result);
    return;
  }

  // Paths that are part of the login machinery itself; never act there.
  if (path.startsWith("/Shibboleth.sso") || path === "/shib_login.php") return;

  if (state === "in") {
    browser.runtime.sendMessage({ type: "loggedIn" });
    sessionStorage.removeItem(ATTEMPTS_KEY);
    const returnUrl = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    if (returnUrl && returnUrl !== location.href) location.replace(returnUrl);
    return;
  }

  const settings = await getSettings();
  const { pausedByLogout } = await browser.storage.local.get("pausedByLogout");
  if (!settings.enabled || !settings.autoLogin || pausedByLogout) return;

  // Loop guard: give up if we keep bouncing back here without a session.
  const now = Date.now();
  const attempts = JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) || "[]")
    .filter((t) => now - t < ATTEMPT_WINDOW_MS);
  if (attempts.length >= MAX_ATTEMPTS) {
    browser.runtime.sendMessage({ type: "loginFailed", reason: "Too many login attempts in a row; stopped." });
    return;
  }
  attempts.push(now);
  sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));

  // login.php?target=crs_123 maps straight to an ILIAS goto target; anything else
  // (a public page shown after the session ran out) is restored after login.
  let gotoTarget = null;
  if (path === "/login.php") {
    gotoTarget = params.get("target");
  } else {
    // Prefer the URL the user actually asked for over where ILIAS redirected us.
    const originalUrl = await browser.runtime.sendMessage({ type: "getOriginalUrl" });
    sessionStorage.setItem(RETURN_KEY, isReturnable(originalUrl) ? originalUrl : location.href);
  }

  await browser.runtime.sendMessage({ type: "loginStarted" });
  location.replace(shibLoginUrl(gotoTarget));

  function isReturnable(url) {
    if (!url) return false;
    const p = new URL(url).pathname;
    return !(p.startsWith("/Shibboleth.sso") || p === "/shib_login.php" || p === "/login.php" || /logout/i.test(url));
  }

  function showLogoutNotice(result) {
    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;" +
      "max-width:90vw;padding:10px 16px;border-radius:6px;font:14px system-ui,sans-serif;" +
      "box-shadow:0 2px 10px rgba(0,0,0,.25);color:#fff;" +
      (result && result.ok ? "background:#2e7d32" : "background:#c62828");
    box.textContent = result && result.ok
      ? "ILIAS Stay Signed In: edu-ID session cleared. You are fully logged out, no need to close the browser."
      : "ILIAS Stay Signed In: could not clear the edu-ID session. Close the browser to finish logging out.";
    document.body.append(box);
  }
})();
