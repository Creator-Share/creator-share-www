import "server-only"

import { randomBytes } from "node:crypto"

export const SPONSOR_EMAIL_CONFIRMATION_TOKEN_HASH_MINIMUM_LENGTH = 32
export const SPONSOR_EMAIL_CONFIRMATION_TOKEN_HASH_MAXIMUM_LENGTH = 384
export const SPONSOR_EMAIL_CONFIRMATION_FRAGMENT_MAXIMUM_LENGTH = 512
export const SPONSOR_EMAIL_CONFIRMATION_BODY_MAXIMUM_BYTES = 1024
export const CREATOR_SHARE_ACCOUNT_ONBOARDING_PATH = "/app/main/onboarding"

export const SPONSOR_EMAIL_CONFIRMATION_DESTINATIONS = Object.freeze([
  "/app",
  "/sponsor/claim",
  CREATOR_SHARE_ACCOUNT_ONBOARDING_PATH,
] as const)

export type SponsorEmailConfirmationDestination =
  (typeof SPONSOR_EMAIL_CONFIRMATION_DESTINATIONS)[number]

const TOKEN_HASH_PATTERN = /^[A-Za-z0-9._~-]+$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const NONCE_PATTERN = /^[A-Za-z0-9_-]{24}$/

export interface SponsorEmailConfirmationRequest {
  tokenHash: string
  next: SponsorEmailConfirmationDestination
}

export interface SponsorEmailSessionIdentity {
  authUserId: string
  authSessionId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isValidTokenHash(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= SPONSOR_EMAIL_CONFIRMATION_TOKEN_HASH_MINIMUM_LENGTH &&
    value.length <= SPONSOR_EMAIL_CONFIRMATION_TOKEN_HASH_MAXIMUM_LENGTH &&
    TOKEN_HASH_PATTERN.test(value)
  )
}

export function isSponsorEmailConfirmationDestination(
  value: unknown,
): value is SponsorEmailConfirmationDestination {
  return SPONSOR_EMAIL_CONFIRMATION_DESTINATIONS.some(
    (destination) => destination === value,
  )
}

export function parseSponsorEmailConfirmationRequest(
  serializedBody: string,
): SponsorEmailConfirmationRequest | null {
  if (
    typeof serializedBody !== "string" ||
    Buffer.byteLength(serializedBody, "utf8") >
      SPONSOR_EMAIL_CONFIRMATION_BODY_MAXIMUM_BYTES
  ) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(serializedBody)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const keys = Object.keys(parsed).sort()
  if (
    keys.length !== 2 ||
    keys[0] !== "next" ||
    keys[1] !== "tokenHash" ||
    !isValidTokenHash(parsed.tokenHash) ||
    !isSponsorEmailConfirmationDestination(parsed.next)
  ) {
    return null
  }

  return Object.freeze({ tokenHash: parsed.tokenHash, next: parsed.next })
}

function decodeJwtPayload(accessToken: string): Record<string, unknown> | null {
  if (accessToken.length < 32 || accessToken.length > 16_384) return null
  const segments = accessToken.split(".")
  const encodedPayload = segments.length === 3 ? segments[1] : ""
  if (
    encodedPayload.length === 0 ||
    encodedPayload.length > 8_192 ||
    !BASE64URL_PATTERN.test(encodedPayload)
  ) {
    return null
  }

  try {
    const decoded = Buffer.from(encodedPayload, "base64url")
    if (decoded.toString("base64url") !== encodedPayload) return null
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(decoded),
    )
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * The access token is accepted only after verifyOtp and getUser have both
 * succeeded against Supabase. This parser extracts the provider session key
 * that the service-only receipt recorder independently verifies in auth.sessions.
 */
export function parseSponsorEmailSessionIdentity(options: {
  accessToken: unknown
  verifiedAuthUserId: unknown
}): SponsorEmailSessionIdentity | null {
  if (
    typeof options.accessToken !== "string" ||
    typeof options.verifiedAuthUserId !== "string" ||
    !UUID_PATTERN.test(options.verifiedAuthUserId)
  ) {
    return null
  }
  const payload = decodeJwtPayload(options.accessToken)
  if (payload === null) return null
  const subject = payload.sub
  const sessionId = payload.session_id
  if (
    subject !== options.verifiedAuthUserId ||
    typeof sessionId !== "string" ||
    !UUID_PATTERN.test(sessionId)
  ) {
    return null
  }
  return Object.freeze({
    authUserId: options.verifiedAuthUserId,
    authSessionId: sessionId,
  })
}

export function parseSponsorEmailAuthenticationReceipt(
  value: unknown,
  now = Date.now(),
): { receiptExpiresAt: string } | null {
  const row = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : null
    : value
  if (!isRecord(row)) return null
  const keys = Object.keys(row)
  const receiptExpiresAt = row.receipt_expires_at
  if (
    keys.length !== 1 ||
    keys[0] !== "receipt_expires_at" ||
    typeof receiptExpiresAt !== "string"
  ) {
    return null
  }
  const epoch = Date.parse(receiptExpiresAt)
  return Number.isFinite(epoch) && epoch > now
    ? Object.freeze({ receiptExpiresAt })
    : null
}

function htmlEscapeJson(value: string): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
}

export const SPONSOR_EMAIL_CONFIRMATION_HEADERS = Object.freeze({
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
})

export function createSponsorEmailConfirmationInterstitial(options: {
  next: SponsorEmailConfirmationDestination
  nonce?: string
}): { html: string; headers: Readonly<Record<string, string>> } {
  const nonce = options.nonce ?? randomBytes(18).toString("base64url")
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error("sponsor_email_confirmation_unavailable")
  }

  const next = htmlEscapeJson(options.next)
  const endpoint = htmlEscapeJson("/auth/confirm")
  const maximumFragmentLength = JSON.stringify(
    SPONSOR_EMAIL_CONFIRMATION_FRAGMENT_MAXIMUM_LENGTH,
  )
  const minimumTokenLength = JSON.stringify(
    SPONSOR_EMAIL_CONFIRMATION_TOKEN_HASH_MINIMUM_LENGTH,
  )
  const maximumTokenLength = JSON.stringify(
    SPONSOR_EMAIL_CONFIRMATION_TOKEN_HASH_MAXIMUM_LENGTH,
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
  <title>Secure sign in | Creator Share</title>
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
    <h1>Continue to your sponsorship account</h1>
    <p>Confirm this one-time link to sign in securely. The link works only once.</p>
    <form id="confirmation-form" novalidate>
      <button id="continue" type="submit" disabled>Continue securely</button>
    </form>
    <p id="status" role="status" aria-live="polite">Checking your sign-in link.</p>
    <noscript><p class="error">JavaScript is required to complete this secure sign in.</p></noscript>
  </main>
  <script nonce="${nonce}">
    (() => {
      "use strict";
      let rawFragment = window.location.hash;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      const form = document.getElementById("confirmation-form");
      const button = document.getElementById("continue");
      const status = document.getElementById("status");
      const next = ${next};

      const fail = (message) => {
        status.textContent = message;
        status.className = "error";
        button.disabled = true;
      };

      const validEnvelope = rawFragment.length >= 2 && rawFragment.length <= ${maximumFragmentLength} && rawFragment.startsWith("#") && !/[^\x21-\x7e]/.test(rawFragment);
      const parameters = new URLSearchParams(validEnvelope ? rawFragment.slice(1) : "");
      rawFragment = "";
      const keys = Array.from(parameters.keys()).sort();
      const exactKeys = keys.length === 2 && keys[0] === "token_hash" && keys[1] === "v" && parameters.getAll("token_hash").length === 1 && parameters.getAll("v").length === 1;
      let candidateTokenHash = parameters.get("token_hash") || "";
      const valid = validEnvelope && exactKeys && candidateTokenHash.length >= ${minimumTokenLength} && candidateTokenHash.length <= ${maximumTokenLength} && /^[A-Za-z0-9._~-]+$/.test(candidateTokenHash) && parameters.get("v") === "1";
      let material = valid ? { tokenHash: candidateTokenHash, next } : null;
      candidateTokenHash = "";
      parameters.delete("token_hash");

      if (!valid) {
        fail("This sign-in link is invalid or incomplete. Request a new link and try again.");
        return;
      }

      status.textContent = "Your secure sign-in link is ready.";
      button.disabled = false;

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (material === null) return;
        button.disabled = true;
        status.className = "";
        status.textContent = "Verifying your sign-in link.";
        try {
          const confirmationRequest = fetch(${endpoint}, {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            redirect: "error",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(material),
          });
          material = null;
          const response = await confirmationRequest;
          const payload = await response.json();
          const exactPayload = payload && typeof payload === "object" && !Array.isArray(payload) && Object.keys(payload).length === 2 && payload.ok === true && payload.redirect === next;
          if (response.status !== 200 || !exactPayload) {
            throw new Error("confirmation_failed");
          }
          status.textContent = "Sign in complete. Opening your account.";
          window.location.assign(payload.redirect);
        } catch {
          material = null;
          fail("This link could not be verified. It may be expired or already used. Request a new link if the problem continues.");
        }
      });
    })();
  </script>
</body>
</html>`

  return Object.freeze({
    html,
    headers: Object.freeze({
      ...SPONSOR_EMAIL_CONFIRMATION_HEADERS,
      "Content-Security-Policy": contentSecurityPolicy,
      "Content-Type": "text/html; charset=utf-8",
    }),
  })
}
