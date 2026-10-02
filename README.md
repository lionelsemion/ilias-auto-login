# ILIAS Unibe – Stay Signed In (Firefox)

Keeps you signed in on <https://ilias.unibe.ch>, which logs in through Shibboleth and Switch edu-ID.

## How it works

1. **Keep-alive.** Every N minutes (5 by default), the background script fetches the ILIAS dashboard with your cookies, so the ILIAS session never times out from inactivity.
2. **Automatic re-login.** When an ILIAS page shows you as logged out, the extension skips the WAYF and goes straight to
   `/Shibboleth.sso/Login?entityID=https://aai-idp.unibe.ch/idp/shibboleth`, which leads to `unibe.login.eduid.ch`.
   - If your edu-ID session is still valid, edu-ID sends you straight back to ILIAS with no clicks.
   - If not, the extension clicks through the e-mail step and the password step. The password comes from **Firefox's password manager**; the extension never stores it.
   - After login you're returned to the page you were on, or to the `login.php?target=…` goto target.
3. **Background re-login.** If a keep-alive ping finds the session gone while an ILIAS tab is open, the login runs in an inactive tab, which closes itself when it finishes.
4. **Safety stops.**
   - edu-ID pages are only automated for login flows the extension started.
   - Each step is submitted at most once, so a wrong password won't loop.
   - After 3 attempts in 5 minutes it gives up and shows a red `!` badge.
   - Logging out pauses auto-login until you log in again (by hand or with "Log in now").
   - MFA, consent, and notice pages are left for you.

## Logout

ILIAS's logout page asks you to close the browser to finish logging out. That step drops the edu-ID single-sign-on *session cookie*; while it exists, the next login skips the password. The extension does that step for you: when it sees the logout, it deletes the session-only cookies of `eduid.ch` and `ilias.unibe.ch`, then shows a green notice. Saved cookies (language, trusted device) are kept, just as they are when Firefox restarts.

## Install

Release Firefox only installs add-ons signed by Mozilla. This one is signed as an **unlisted** add-on: Mozilla signs it automatically, usually within minutes, and it is not published on addons.mozilla.org.

1. Log in at <https://addons.mozilla.org> (a Firefox account is enough) and create an API key at <https://addons.mozilla.org/developers/addon/api/key/>.
2. Sign the extension:
   ```sh
   AMO_JWT_ISSUER='user:…' AMO_JWT_SECRET='…' ./sign.py
   ```
   This builds the zip, uploads it, waits for validation and signing, and saves `dist/ilias-stay-signed-in-<version>.xpi`.
3. Install the `.xpi` by dragging it into a Firefox window, or via `about:addons` → ⚙ → "Install Add-on From File…".
4. In `about:addons` → this extension → Permissions, make sure access to `ilias.unibe.ch` and `eduid.ch` is allowed.

**Updates:** raise `"version"` in `extension/manifest.json`, run `./sign.py` again, and install the new `.xpi` over the old one. Settings are kept.

**During development:** load `extension/manifest.json` from `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…". This lasts until Firefox restarts.

## Setup

1. Log in to ILIAS once by hand, and let Firefox **save your edu-ID password** when it asks (on `unibe.login.eduid.ch`).
2. Optionally, enter your edu-ID e-mail in the extension popup. If you don't, the extension relies on autofill.
3. In Firefox settings, keep "Autofill logins and passwords" enabled.
