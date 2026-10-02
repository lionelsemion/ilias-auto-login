#!/usr/bin/env python3
"""Sign the extension as an unlisted add-on on addons.mozilla.org (AMO).

Usage:
    AMO_JWT_ISSUER=user:123:456 AMO_JWT_SECRET=... ./sign.py

Get the key/secret at https://addons.mozilla.org/developers/addon/api/key/
The signed .xpi is written to dist/. Each upload needs a new "version" in
extension/manifest.json.
"""

import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

API = "https://addons.mozilla.org/api/v5/addons"
ROOT = os.path.dirname(os.path.abspath(__file__))
ZIP = os.path.join(ROOT, "ilias-stay-signed-in.zip")
DIST = os.path.join(ROOT, "dist")


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def jwt(issuer, secret):
    now = int(time.time())
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64url(json.dumps({"iss": issuer, "jti": str(uuid.uuid4()), "iat": now, "exp": now + 60}).encode())
    signing_input = f"{header}.{payload}".encode()
    sig = b64url(hmac.new(secret.encode(), signing_input, hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


class Amo:
    def __init__(self, issuer, secret):
        self.issuer, self.secret = issuer, secret

    def request(self, method, url, body=None, content_type="application/json", raw=False):
        headers = {"Authorization": "JWT " + jwt(self.issuer, self.secret)}
        if body is not None:
            headers["Content-Type"] = content_type
            if content_type == "application/json":
                body = json.dumps(body).encode()
        req = urllib.request.Request(url, data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req) as res:
                data = res.read()
                return data if raw else json.loads(data or b"null")
        except urllib.error.HTTPError as e:
            e.body = e.read().decode(errors="replace")
            raise

    def upload(self, path):
        boundary = uuid.uuid4().hex
        with open(path, "rb") as f:
            file_data = f.read()
        parts = [
            f'--{boundary}\r\nContent-Disposition: form-data; name="channel"\r\n\r\nunlisted\r\n'.encode(),
            (f'--{boundary}\r\nContent-Disposition: form-data; name="upload"; filename="{os.path.basename(path)}"\r\n'
             "Content-Type: application/zip\r\n\r\n").encode() + file_data + b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
        return self.request("POST", API + "/upload/", b"".join(parts), f"multipart/form-data; boundary={boundary}")


def wait(fetch, done, what, timeout=900):
    start = time.time()
    while True:
        obj = fetch()
        if done(obj):
            return obj
        if time.time() - start > timeout:
            sys.exit(f"Timed out waiting for {what}.")
        print(f"  waiting for {what}…")
        time.sleep(10)


def main():
    issuer, secret = os.environ.get("AMO_JWT_ISSUER"), os.environ.get("AMO_JWT_SECRET")
    if not issuer or not secret:
        sys.exit(__doc__)

    with open(os.path.join(ROOT, "extension", "manifest.json")) as f:
        manifest = json.load(f)
    guid = manifest["browser_specific_settings"]["gecko"]["id"]
    version = manifest["version"]

    subprocess.run([os.path.join(ROOT, "build.sh")], check=True)
    amo = Amo(issuer, secret)

    print(f"Uploading {guid} {version}…")
    upload = amo.upload(ZIP)
    upload = wait(lambda: amo.request("GET", f"{API}/upload/{upload['uuid']}/"),
                  lambda u: u["processed"], "validation")
    if not upload["valid"]:
        print(json.dumps(upload.get("validation"), indent=2))
        sys.exit("Validation failed (see above).")

    # New add-on: PUT creates it with this version. Existing add-on: add a version.
    try:
        amo.request("GET", f"{API}/addon/{guid}/")
        exists = True
    except urllib.error.HTTPError as e:
        if e.code not in (401, 403, 404):
            raise
        exists = False
    try:
        if exists:
            ver = amo.request("POST", f"{API}/addon/{guid}/versions/", {"upload": upload["uuid"]})
        else:
            addon = amo.request("PUT", f"{API}/addon/{guid}/", {"version": {"upload": upload["uuid"]}})
            ver = addon["latest_unlisted_version"]
    except urllib.error.HTTPError as e:
        sys.exit(f"AMO refused the version ({e.code}): {e.body}")

    ver = wait(lambda: amo.request("GET", f"{API}/addon/{guid}/versions/{ver['id']}/"),
               lambda v: v["file"]["status"] in ("public", "disabled"), "signing")
    if ver["file"]["status"] != "public":
        sys.exit(f"Signing did not succeed (status: {ver['file']['status']}).")

    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, f"ilias-stay-signed-in-{version}.xpi")
    with open(out, "wb") as f:
        f.write(amo.request("GET", ver["file"]["url"], raw=True))
    print(f"Signed: {out}\nInstall it by dragging the file into Firefox, or via about:addons → ⚙ → Install Add-on From File.")


if __name__ == "__main__":
    main()
