import { randomBytes } from "node:crypto"

import {
  ADVOCATE_INVITATION_AUTH_TOKEN_HASH_MAXIMUM_LENGTH,
  ADVOCATE_INVITATION_MAXIMUM_FRAGMENT_LENGTH,
  ADVOCATE_INVITATION_REDEEM_PATH,
} from "@/lib/advocates/invitations/material"

export const ADVOCATE_INVITATION_INTERSTITIAL_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy":
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
} as const)

const NONCE_PATTERN = /^[A-Za-z0-9_-]{24}$/

function htmlEscapeJson(value: string): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
}

export function createAdvocateInvitationInterstitial(
  nonce = randomBytes(18).toString("base64url"),
): { html: string; headers: Readonly<Record<string, string>> } {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error("advocate_invitation_interstitial_unavailable")
  }

  const redeemPath = htmlEscapeJson(ADVOCATE_INVITATION_REDEEM_PATH)
  const maximumAuthTokenHashLength = JSON.stringify(
    ADVOCATE_INVITATION_AUTH_TOKEN_HASH_MAXIMUM_LENGTH,
  )
  const maximumFragmentLength = JSON.stringify(
    ADVOCATE_INVITATION_MAXIMUM_FRAGMENT_LENGTH,
  )
  const contentSecurityPolicy = [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
  ].join("; ")

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
  <title>Accept your invitation | Creator Share</title>
  <style nonce="${nonce}">
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f7f9; color: #111827; padding: 1.25rem; }
    main { width: min(100%, 34rem); background: #fff; border: 1px solid #d1d5db; border-radius: 1rem; padding: clamp(1.5rem, 5vw, 2.5rem); box-shadow: 0 1rem 3rem rgb(17 24 39 / 8%); }
    .eyebrow { color: #1d4ed8; font-size: .875rem; font-weight: 750; letter-spacing: .02em; margin: 0 0 .75rem; }
    h1 { font-size: clamp(1.75rem, 6vw, 2.35rem); line-height: 1.1; margin: 0; }
    p { color: #4b5563; line-height: 1.6; }
    button { width: 100%; min-height: 3rem; margin-top: .75rem; border: 0; border-radius: .625rem; background: #1d4ed8; color: #fff; font: inherit; font-weight: 750; padding: .75rem 1rem; cursor: pointer; }
    button:hover { background: #1e40af; }
    button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 3px; }
    button:disabled { background: #9ca3af; cursor: wait; }
    #status { min-height: 1.5rem; font-size: .9375rem; }
    .error { color: #991b1b; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Creator Share</p>
    <h1>Accept your advocate portal invitation</h1>
    <p>You have been invited to help manage a Creator Share advocate portal. Continue to verify your email and activate your access.</p>
    <form id="invitation-form" novalidate>
      <button id="continue" type="submit" disabled>Continue securely</button>
    </form>
    <p id="status" role="status" aria-live="polite">Checking your invitation link.</p>
    <noscript><p class="error">JavaScript is required to accept this secure invitation.</p></noscript>
  </main>
  <script nonce="${nonce}">
    (() => {
      "use strict";
      const form = document.getElementById("invitation-form");
      const button = document.getElementById("continue");
      const status = document.getElementById("status");
      const rawFragment = window.location.hash;
      window.history.replaceState(null, "", window.location.pathname);

      const fail = (message) => {
        status.textContent = message;
        status.className = "error";
        button.disabled = true;
      };

      const validFragmentEnvelope = rawFragment.length >= 2 && rawFragment.length <= ${maximumFragmentLength} && rawFragment.startsWith("#") && !/[^\x21-\x7e]/.test(rawFragment);
      const parameters = new URLSearchParams(validFragmentEnvelope ? rawFragment.slice(1) : "");
      const keys = Array.from(parameters.keys()).sort();
      const expectedKeys = ["auth", "capability", "type", "v"];
      const exactKeys = keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]) && expectedKeys.every((key) => parameters.getAll(key).length === 1);
      const capability = parameters.get("capability") || "";
      const authTokenHash = parameters.get("auth") || "";
      const authType = parameters.get("type") || "";
      const version = parameters.get("v");
      const valid = validFragmentEnvelope && exactKeys && /^[0-9a-f]{64}$/.test(capability) && authTokenHash.length >= 32 && authTokenHash.length <= ${maximumAuthTokenHashLength} && /^[A-Za-z0-9._~-]+$/.test(authTokenHash) && authType === "magiclink" && version === "1";

      if (!valid) {
        fail("This invitation link is invalid or incomplete. Request a new invitation from the portal administrator.");
        return;
      }

      let material = { capability, authTokenHash, authType, version: 1 };
      status.textContent = "Your invitation is ready to verify.";
      button.disabled = false;

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (material === null) return;
        button.disabled = true;
        status.className = "";
        status.textContent = "Verifying your invitation.";
        try {
          const response = await fetch(${redeemPath}, {
            method: "POST",
            credentials: "same-origin",
            redirect: "error",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(material),
          });
          const payload = await response.json();
          if (!response.ok || !payload || payload.redirect !== "/portal") {
            throw new Error("invitation_failed");
          }
          material = null;
          status.textContent = "Invitation accepted. Opening your portal.";
          window.location.assign("/portal");
        } catch {
          fail("This invitation could not be accepted. It may be expired or already used. Request a new invitation if the problem continues.");
          button.disabled = false;
        }
      });
    })();
  </script>
</body>
</html>`

  return {
    html,
    headers: Object.freeze({
      ...ADVOCATE_INVITATION_INTERSTITIAL_HEADERS,
      "Content-Security-Policy": contentSecurityPolicy,
      "Content-Type": "text/html; charset=utf-8",
    }),
  }
}
