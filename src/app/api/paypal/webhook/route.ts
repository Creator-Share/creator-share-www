import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import {
  asPayPalWebhookError,
  ingestVerifiedPayPalEvent,
  parsePayPalWebhookEvent,
  parsePayPalWebhookHeaders,
  quarantineVerifiedPayPalEvent,
  readBoundedPayPalWebhookPayload,
  validatePayPalWebhookId,
  verifyPayPalWebhookSignature,
  type PayPalWebhookRequestContext,
} from "@/lib/sponsorships/gateways/paypalWebhook"
import {
  createPayPalWebhookDependencies,
  getConfiguredPayPalApiUrl,
} from "@/lib/sponsorships/gateways/paypalWebhookRuntime"
import { isPayPalEnabled } from "@/lib/paypal/client"

function boundedHeader(
  request: Request,
  name: string,
  maximumLength: number,
): string | null {
  const value = request.headers.get(name)?.trim()
  return value ? value.slice(0, maximumLength) : null
}

function unavailable() {
  return NextResponse.json(
    { error: "Webhook ingestion is temporarily unavailable" },
    { status: 503 },
  )
}

export async function POST(request: Request) {
  if (!isPayPalEnabled()) {
    return NextResponse.json(
      { error: "PayPal integration is not enabled" },
      { status: 501 },
    )
  }

  const requestId = randomUUID()
  let rawPayload: string
  let event
  let paypalHeaders
  let webhookId: string
  try {
    webhookId = validatePayPalWebhookId(process.env.PAYPAL_WEBHOOK_ID)
    paypalHeaders = parsePayPalWebhookHeaders(
      request.headers,
      getConfiguredPayPalApiUrl(),
    )
    rawPayload = await readBoundedPayPalWebhookPayload(request)
    event = parsePayPalWebhookEvent(rawPayload)
  } catch (error) {
    const safeError = asPayPalWebhookError(error)
    if (safeError.retryable) return unavailable()
    return NextResponse.json(
      { error: "Invalid webhook request" },
      { status: safeError.code === "payload-too-large" ? 413 : 400 },
    )
  }

  let dependencies: ReturnType<typeof createPayPalWebhookDependencies>
  try {
    dependencies = createPayPalWebhookDependencies()
  } catch {
    return unavailable()
  }

  let verification
  try {
    verification = await verifyPayPalWebhookSignature(
      {
        rawBody: rawPayload,
        headers: paypalHeaders,
        configuredWebhookId: webhookId,
      },
      dependencies,
    )
  } catch {
    return unavailable()
  }
  if (!verification.verified) {
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 400 },
    )
  }

  const requestContext: PayPalWebhookRequestContext = {
    requestId,
    traceId:
      boundedHeader(request, "x-vercel-id", 255) ??
      boundedHeader(request, "cf-ray", 255) ??
      boundedHeader(request, "traceparent", 255),
    clientIp:
      boundedHeader(request, "cf-connecting-ip", 256) ??
      boundedHeader(request, "x-vercel-forwarded-for", 256) ??
      boundedHeader(request, "x-forwarded-for", 256),
    userAgent: boundedHeader(request, "user-agent", 1024),
    headers: paypalHeaders,
    verificationResponseSha256: verification.responseSha256,
  }

  try {
    const result = await ingestVerifiedPayPalEvent(
      { event, rawPayload, requestContext },
      dependencies,
    )
    return NextResponse.json({
      received: true,
      duplicate: result.isDuplicate,
    })
  } catch (error) {
    const safeError = asPayPalWebhookError(error)
    if (safeError.retryable) return unavailable()

    try {
      const quarantine = await quarantineVerifiedPayPalEvent(
        {
          event,
          rawPayload,
          requestContext,
          error: safeError,
        },
        dependencies,
      )
      return NextResponse.json({
        received: true,
        quarantined: true,
        duplicate: quarantine.isDuplicate,
      })
    } catch {
      return unavailable()
    }
  }
}
