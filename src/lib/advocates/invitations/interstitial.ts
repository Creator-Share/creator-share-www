import { randomBytes } from "node:crypto"

import {
  ADVOCATE_INVITATION_AUTH_TOKEN_HASH_MAXIMUM_LENGTH,
  ADVOCATE_INVITATION_AUTHENTICATE_PATH,
  ADVOCATE_INVITATION_MAXIMUM_FRAGMENT_LENGTH,
  ADVOCATE_INVITATION_RECOVER_PATH,
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

  const authenticatePath = htmlEscapeJson(ADVOCATE_INVITATION_AUTHENTICATE_PATH)
  const redeemPath = htmlEscapeJson(ADVOCATE_INVITATION_REDEEM_PATH)
  const recoverPath = htmlEscapeJson(ADVOCATE_INVITATION_RECOVER_PATH)
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
    #signin { display: block; margin-top: 1rem; text-align: center; color: #1d4ed8; font-weight: 700; }
    #signin[hidden] { display: none; }
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
    <a id="signin" href="/login" target="_blank" rel="noopener noreferrer" hidden>Sign in in another tab</a>
    <p id="status" role="status" aria-live="polite">Checking your invitation link.</p>
    <noscript><p class="error">JavaScript is required to accept this secure invitation.</p></noscript>
  </main>
  <script nonce="${nonce}">
    (() => {
      "use strict";
      const form = document.getElementById("invitation-form");
      const button = document.getElementById("continue");
      const signin = document.getElementById("signin");
      const status = document.getElementById("status");
      const storageKey = "creator_share_advocate_invitation_redemption_v1";
      const operationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      let rawFragment = window.location.hash;
      window.history.replaceState(null, "", window.location.pathname);

      let capability = "";
      let authTokenHash = "";
      let authType = "";
      let activeOperation = null;
      let materialAvailable = false;

      const setFailure = (message, retryable = false) => {
        status.textContent = message;
        status.className = "error";
        button.disabled = !retryable;
      };

      const clearOperation = () => {
        try { window.sessionStorage.removeItem(storageKey); } catch {}
        activeOperation = null;
      };

      const clearSecrets = () => {
        capability = "";
        authTokenHash = "";
        authType = "";
        materialAvailable = false;
      };

      const parseFragmentMaterial = (fragment) => {
        const validEnvelope = fragment.length >= 2 && fragment.length <= ${maximumFragmentLength} && fragment.startsWith("#") && !/[^\x21-\x7e]/.test(fragment);
        const parameters = new URLSearchParams(validEnvelope ? fragment.slice(1) : "");
        const keys = Array.from(parameters.keys()).sort();
        const expectedKeys = ["auth", "capability", "type", "v"];
        const exactKeys = keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]) && expectedKeys.every((key) => parameters.getAll(key).length === 1);
        const parsedCapability = parameters.get("capability") || "";
        const parsedAuthTokenHash = parameters.get("auth") || "";
        const parsedAuthType = parameters.get("type") || "";
        const version = parameters.get("v");
        if (!validEnvelope || !exactKeys || !/^[0-9a-f]{64}$/.test(parsedCapability) || parsedAuthTokenHash.length < 32 || parsedAuthTokenHash.length > ${maximumAuthTokenHashLength} || !/^[A-Za-z0-9._~-]+$/.test(parsedAuthTokenHash) || (parsedAuthType !== "magiclink" && parsedAuthType !== "signup") || version !== "1") return null;
        return { capability: parsedCapability, authTokenHash: parsedAuthTokenHash, authType: parsedAuthType };
      };

      const parseStoredOperation = () => {
        let serialized;
        try { serialized = window.sessionStorage.getItem(storageKey); } catch { return { state: "unavailable" }; }
        if (serialized === null) return { state: "absent" };
        try {
          const parsed = JSON.parse(serialized);
          const keys = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed).sort() : [];
          if (keys.length !== 2 || keys[0] !== "operationId" || keys[1] !== "version" || parsed.version !== 1 || !operationPattern.test(parsed.operationId) || serialized !== JSON.stringify({ operationId: parsed.operationId, version: 1 })) {
            return { state: "invalid" };
          }
          return { state: "valid", operation: { operationId: parsed.operationId, version: 1 } };
        } catch {
          return { state: "invalid" };
        }
      };

      const storeOperation = (operation) => {
        const serialized = JSON.stringify(operation);
        try {
          window.sessionStorage.setItem(storageKey, serialized);
          return window.sessionStorage.getItem(storageKey) === serialized;
        } catch {
          return false;
        }
      };

      const parseJson = async (response) => {
        try { return await response.json(); } catch { return null; }
      };

      const exactSuccess = (payload, operationId) => {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
        const keys = Object.keys(payload).sort();
        return keys.length === 3 && keys[0] === "ok" && keys[1] === "operationId" && keys[2] === "redirect" && payload.ok === true && payload.operationId === operationId && payload.redirect === "/portal";
      };

      const exactFailure = (payload, code) => {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
        const keys = Object.keys(payload).sort();
        return keys.length === 2 && keys[0] === "code" && keys[1] === "ok" && payload.ok === false && payload.code === code;
      };

      const finish = (operationId) => {
        if (!activeOperation || activeOperation.operationId !== operationId) {
          setFailure("The invitation response did not match this browser operation.");
          return false;
        }
        clearSecrets();
        clearOperation();
        status.className = "";
        status.textContent = "Invitation accepted. Opening your portal.";
        window.location.assign("/portal");
        return true;
      };

      const showAuthenticationRecovery = () => {
        signin.hidden = false;
        button.textContent = "Recover access";
        setFailure("Your activation may have completed, but this tab is no longer signed in. Sign in with the invited email in another tab, then return here and recover access.", true);
      };

      let fragmentMaterial = parseFragmentMaterial(rawFragment);
      rawFragment = "";
      const valid = fragmentMaterial !== null;
      if (fragmentMaterial !== null) {
        capability = fragmentMaterial.capability;
        authTokenHash = fragmentMaterial.authTokenHash;
        authType = fragmentMaterial.authType;
        materialAvailable = true;
        fragmentMaterial = null;
      }

      const stored = parseStoredOperation();
      if (stored.state === "valid") {
        activeOperation = stored.operation;
        status.textContent = "Checking whether your invitation was accepted.";
      } else if (valid) {
        if (stored.state === "invalid") clearOperation();
        status.textContent = "Your invitation is ready to verify.";
        button.disabled = false;
      } else {
        if (stored.state === "invalid") clearOperation();
        setFailure(stored.state === "unavailable" ? "Secure browser recovery storage is unavailable. Request a new invitation from the portal administrator." : "This invitation link is invalid or incomplete. Request a new invitation from the portal administrator.");
        return;
      }

      const recover = async () => {
        if (activeOperation === null) return "not_found";
        button.disabled = true;
        signin.hidden = true;
        status.className = "";
        status.textContent = "Recovering your invitation acceptance.";
        try {
          const response = await fetch(${recoverPath}, {
            method: "POST",
            credentials: "same-origin",
            redirect: "error",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(activeOperation),
          });
          const payload = await parseJson(response);
          if (response.ok && exactSuccess(payload, activeOperation.operationId)) {
            finish(activeOperation.operationId);
            return "succeeded";
          }
          if (response.status === 401 && exactFailure(payload, "authentication_required")) {
            showAuthenticationRecovery();
            return "authentication_required";
          }
          if (response.status === 410 && exactFailure(payload, "invalid_or_expired")) {
            button.textContent = materialAvailable ? "Try acceptance again" : "Check again";
            setFailure(materialAvailable ? "No completed activation was found. You can safely retry this exact acceptance operation." : "No completed activation was found yet. The original request may still be finishing. Check this exact operation again before requesting a new invitation.", true);
            return "not_found";
          }
        } catch {}
        button.textContent = "Try recovery again";
        setFailure("Creator Share could not confirm whether activation completed. Retry recovery using this browser tab.", true);
        return "ambiguous";
      };

      const redeem = async () => {
        if (activeOperation === null || !materialAvailable) return;
        button.disabled = true;
        status.className = "";
        status.textContent = "Activating your portal access.";
        try {
          const response = await fetch(${redeemPath}, {
            method: "POST",
            credentials: "same-origin",
            redirect: "error",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ capability, operationId: activeOperation.operationId, version: 1 }),
          });
          const payload = await parseJson(response);
          if (response.ok && exactSuccess(payload, activeOperation.operationId)) {
            finish(activeOperation.operationId);
            return;
          }
          if (response.status === 401 && exactFailure(payload, "authentication_required")) {
            showAuthenticationRecovery();
            return;
          }
          const deterministicFailure =
            (response.status === 400 && exactFailure(payload, "invalid_request")) ||
            (response.status === 409 && (exactFailure(payload, "membership_conflict") || exactFailure(payload, "redemption_conflict"))) ||
            (response.status === 410 && exactFailure(payload, "invalid_or_expired"));
          if (deterministicFailure) {
            clearSecrets();
            clearOperation();
            setFailure("This invitation could not be accepted. It may be expired or already used. Request a new invitation if the problem continues.");
            return;
          }
        } catch {}
        await recover();
      };

      const begin = async () => {
        button.disabled = true;
        status.className = "";
        status.textContent = "Verifying your email.";
        let response;
        try {
          response = await fetch(${authenticatePath}, {
            method: "POST",
            credentials: "same-origin",
            redirect: "error",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ authTokenHash, authType, version: 1 }),
          });
        } catch {
          button.textContent = "Try email verification again";
          setFailure("Creator Share could not confirm whether email verification completed. Retry this exact invitation in this browser tab. No portal changes have been made yet.", true);
          return;
        }
        const payload = await parseJson(response);
        const authenticationSucceeded = response.ok && payload && typeof payload === "object" && !Array.isArray(payload) && Object.keys(payload).length === 1 && payload.ok === true;
        if (!authenticationSucceeded) {
          const deterministicFailure =
            (response.status === 400 && exactFailure(payload, "invalid_request")) ||
            (response.status === 410 && exactFailure(payload, "invalid_or_expired"));
          if (!deterministicFailure) {
            button.textContent = "Try email verification again";
            setFailure("Creator Share could not confirm whether email verification completed. Retry this exact invitation in this browser tab. No portal changes have been made yet.", true);
            return;
          }
          clearSecrets();
          setFailure("This email verification link is invalid or expired. No portal changes were made. Request a new invitation from the portal administrator.");
          return;
        }

        authTokenHash = "";
        authType = "";
        if (activeOperation !== null) {
          const disposition = await recover();
          if (disposition !== "not_found") return;
          clearOperation();
        }
        let operationId;
        try { operationId = window.crypto.randomUUID(); } catch { operationId = ""; }
        if (!operationPattern.test(operationId)) {
          clearSecrets();
          setFailure("Secure invitation activation is unavailable in this browser.");
          return;
        }
        activeOperation = { operationId, version: 1 };
        if (!storeOperation(activeOperation)) {
          clearSecrets();
          activeOperation = null;
          setFailure("Secure browser recovery storage is unavailable. No portal changes were made.");
          return;
        }
        await redeem();
      };

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (materialAvailable && authTokenHash !== "") await begin();
        else {
          const disposition = await recover();
          if (disposition === "not_found" && materialAvailable) await redeem();
        }
      });

      if (activeOperation !== null) void recover();
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
