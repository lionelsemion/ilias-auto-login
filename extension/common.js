// Shared constants and helpers (loaded in background, content scripts and options page).

const ILIAS_ORIGIN = "https://ilias.unibe.ch";
// University of Bern IdP; it is hosted by Switch edu-ID at unibe.login.eduid.ch.
const IDP_ENTITY_ID = "https://aai-idp.unibe.ch/idp/shibboleth";
// Domains whose session cookies are dropped on logout (subdomains included).
const SESSION_COOKIE_DOMAINS = ["eduid.ch", "ilias.unibe.ch"];
// Page fetched by the keep-alive ping. Any page that requires a session works.
const PING_URL = ILIAS_ORIGIN + "/ilias.php?baseClass=ilDashboardGUI";

const DEFAULT_SETTINGS = {
  enabled: true,
  keepAliveMinutes: 5,
  autoLogin: true,
  silentRelogin: true,
  email: "",
};

async function getSettings() {
  const stored = await browser.storage.local.get("settings");
  return Object.assign({}, DEFAULT_SETTINGS, stored.settings);
}

// Shibboleth login URL that skips the WAYF and goes straight to the Unibe/edu-ID IdP.
// `gotoTarget` is an ILIAS goto target such as "crs_123" (optional).
function shibLoginUrl(gotoTarget) {
  let returnUrl = ILIAS_ORIGIN + "/shib_login.php";
  if (gotoTarget) returnUrl += "?target=" + encodeURIComponent(gotoTarget);
  return (
    ILIAS_ORIGIN +
    "/Shibboleth.sso/Login?entityID=" + encodeURIComponent(IDP_ENTITY_ID) +
    "&target=" + encodeURIComponent(returnUrl)
  );
}

// Decide from an ILIAS page whether the user is logged in.
// Anonymous (public) pages always carry a "force_login" link to login.php.
function iliasLoginState(url, html) {
  const path = new URL(url).pathname;
  if (path === "/login.php" || path === "/logout.php") return "out";
  if (/login\.php\?[^"']*cmd=force_login/.test(html)) return "out";
  if (/name="login_form"/.test(html)) return "out";
  return "in";
}
