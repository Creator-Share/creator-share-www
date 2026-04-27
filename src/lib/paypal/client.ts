// Minimal PayPal API client used by server-side flows (cancel, webhook helpers).
// PayPal has no regional-account split today — the architectural decision is
// single PayPal account, multi-region Stripe.

export const isPayPalEnabled = !!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID

export function getPayPalApiUrl(): string {
  return process.env.PAYPAL_API_URL || "https://api-m.sandbox.paypal.com"
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

export async function getPayPalAccessToken(): Promise<string> {
  const { clientId, clientSecret } = getClientCredentials()
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")

  const response = await fetch(`${getPayPalApiUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error("PayPal token error response:", errorText)
    throw new Error("Failed to get PayPal access token")
  }

  const data = (await response.json()) as { access_token?: string }
  if (!data.access_token) {
    throw new Error("Invalid PayPal token response")
  }
  return data.access_token
}

export interface PayPalCancelResult {
  cancelled: boolean
  alreadyCancelled: boolean
  notFound: boolean
  error?: string
}

// POST /v1/billing/subscriptions/{id}/cancel — 204 on success.
// Treat 404 and "already cancelled" as soft success so the DB state can still
// be reconciled.
export async function cancelPayPalSubscription(
  subscriptionId: string,
  reason = "Cancelled by subscriber",
): Promise<PayPalCancelResult> {
  if (!isPayPalEnabled) {
    return {
      cancelled: false,
      alreadyCancelled: false,
      notFound: false,
      error: "PayPal integration is not enabled",
    }
  }

  const accessToken = await getPayPalAccessToken()
  const response = await fetch(
    `${getPayPalApiUrl()}/v1/billing/subscriptions/${subscriptionId}/cancel`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason }),
    },
  )

  if (response.status === 204) {
    return { cancelled: true, alreadyCancelled: false, notFound: false }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = await response.text().catch(() => "")
  }

  const bodyObj =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const paypalName = typeof bodyObj.name === "string" ? bodyObj.name : ""
  const paypalMessage =
    typeof bodyObj.message === "string" ? bodyObj.message : ""

  if (response.status === 404 || paypalName === "RESOURCE_NOT_FOUND") {
    return { cancelled: false, alreadyCancelled: false, notFound: true }
  }

  // PayPal returns 422 SUBSCRIPTION_STATUS_INVALID for already-cancelled subs.
  if (
    response.status === 422 &&
    /CANCELLED|SUSPENDED|EXPIRED/i.test(
      paypalName + " " + paypalMessage + " " + JSON.stringify(body),
    )
  ) {
    return { cancelled: false, alreadyCancelled: true, notFound: false }
  }

  console.error("PayPal cancel failed:", {
    status: response.status,
    body,
    subscriptionId,
  })
  return {
    cancelled: false,
    alreadyCancelled: false,
    notFound: false,
    error: paypalMessage || `PayPal cancel failed with status ${response.status}`,
  }
}
