// Minimal PayPal API client used by server-side flows (cancel, webhook helpers).
// PayPal has no regional-account split today — the architectural decision is
// single PayPal account, multi-region Stripe.

export const PAYPAL_LIVE_API_URL = "https://api-m.paypal.com"
export const PAYPAL_SANDBOX_API_URL = "https://api-m.sandbox.paypal.com"

// Function rather than module-load const so server-side toggles take effect
// without a process restart (e.g. flipping PayPal on/off via an env update on
// the next request lifecycle).
export function isPayPalEnabled(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || process.env.PAYPAL_CLIENT_ID
  )
}

// Default to the LIVE PayPal endpoint. Defaulting to sandbox previously meant
// that a production deploy without PAYPAL_API_URL set would silently hit
// sandbox, return 404 for real subscriptions, and let cancel flows update our
// DB while the live subscription kept billing. Sandbox is now strictly opt-in
// via PAYPAL_API_URL=https://api-m.sandbox.paypal.com.
export function getPayPalApiUrl(): string {
  const configuredUrl = process.env.PAYPAL_API_URL
  if (!configuredUrl) return PAYPAL_LIVE_API_URL
  if (
    configuredUrl !== PAYPAL_LIVE_API_URL &&
    configuredUrl !== PAYPAL_SANDBOX_API_URL
  ) {
    throw new Error("PayPal API URL is invalid")
  }
  return configuredUrl
}

function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId =
    process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || process.env.PAYPAL_CLIENT_ID
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("PayPal client ID or secret is not configured")
  }
  return { clientId, clientSecret }
}

// paypalFetch wraps fetch with the PayPal base URL and an auto-acquired bearer
// token. Callers pass a relative path (e.g. "/v2/checkout/orders/123") and an
// optional RequestInit; this keeps every PayPal route from re-spelling the
// access-token + base-URL boilerplate. Returns the raw Response so callers can
// branch on status codes for partial successes (e.g. RESOURCE_NOT_FOUND).
export async function paypalFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const accessToken = await getPayPalAccessToken(init.signal)
  const headers = new Headers(init.headers)
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`)
  }
  if (!headers.has("Content-Type") && init.method && init.method !== "GET") {
    headers.set("Content-Type", "application/json")
  }
  return fetch(`${getPayPalApiUrl()}${path}`, { ...init, headers })
}

export async function getPayPalAccessToken(
  signal?: AbortSignal | null,
): Promise<string> {
  if (!isPayPalEnabled()) {
    throw new Error("PayPal integration is not enabled")
  }
  const { clientId, clientSecret } = getClientCredentials()
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")

  const response = await fetch(`${getPayPalApiUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal,
  })

  if (!response.ok) {
    console.error("PayPal token request failed", {
      httpStatus: response.status,
    })
    throw new Error("Failed to get PayPal access token")
  }

  const data = (await response.json()) as { access_token?: string }
  if (!data.access_token) {
    throw new Error("Invalid PayPal token response")
  }
  return data.access_token
}
