// Runs on *.login.eduid.ch: clicks through the edu-ID login steps, but only for
// login flows the extension started (so manual logins / account switches are untouched).

(async () => {
  const flow = await browser.runtime.sendMessage({ type: "getFlow" });
  if (!flow) return;
  const settings = await getSettings();
  if (!settings.enabled || !settings.autoLogin) return;

  const updateFlow = (patch) => browser.runtime.sendMessage({ type: "updateFlow", patch });
  const fail = (reason) => browser.runtime.sendMessage({ type: "loginFailed", reason });

  // Wait until `check()` returns something truthy, or give up after `timeoutMs`.
  const waitFor = (check, timeoutMs) => new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const value = check();
      if (value || Date.now() - start > timeoutMs) return resolve(value);
      setTimeout(tick, 200);
    };
    tick();
  });

  const hasErrorMessage = () =>
    document.querySelector(".alert-danger, .alert-error, .invalid-feedback:not(:empty), .is-invalid");

  // Step 0: "Loading Session Information" page. It submits itself via JS;
  // click Continue as a fallback if it hasn't after a few seconds.
  const sessionForm = document.querySelector('form[name="form1"] input[name="shib_idp_ls_supported"]');
  if (sessionForm) {
    setTimeout(() => {
      const btn = document.querySelector('form[name="form1"] input[type="submit"]');
      if (btn) btn.click();
    }, 4000);
    return;
  }

  // Step 1: e-mail.
  const loginForm = document.getElementById("loginForm");
  const emailInput = loginForm && loginForm.querySelector("#username");
  if (loginForm && emailInput) {
    if (flow.emailSubmitted || hasErrorMessage()) {
      return fail("edu-ID did not accept the e-mail step; please log in manually once.");
    }
    if (!emailInput.value && settings.email) {
      emailInput.value = settings.email;
      emailInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    // Give Firefox's password manager a moment to autofill if no e-mail is configured.
    const ok = await waitFor(() => emailInput.value, 3000);
    if (!ok) return fail("No e-mail configured or autofilled for edu-ID.");
    await updateFlow({ emailSubmitted: true });
    document.getElementById("button-submit").click();
    return;
  }

  // Step 2: password. We never store it; it must come from Firefox's password manager.
  const passwordForm = document.getElementById("passwordForm");
  const passwordInput = passwordForm && passwordForm.querySelector("#password");
  if (passwordForm && passwordInput) {
    if (flow.passwordSubmitted || hasErrorMessage()) {
      return fail("edu-ID rejected the password; please log in manually.");
    }
    const ok = await waitFor(() => passwordInput.value, 5000);
    if (!ok) return fail("Password was not autofilled. Save your edu-ID password in Firefox.");
    await updateFlow({ passwordSubmitted: true });
    document.getElementById("button-proceed").click();
    return;
  }

  // Anything else (MFA, consent, notices) is left for the user.
})();
