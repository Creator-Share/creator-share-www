import { randomUUID } from "node:crypto"

import { NextRequest, NextResponse } from "next/server"

import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedCheckoutRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import {
  MAXIMUM_SUBSCRIPTION_CANCELLATION_BODY_BYTES,
  parseSubscriptionCancellationBody,
  SubscriptionCancellationBoundaryError,
  type SubscriptionCancellationRequestContext,
} from "@/lib/sponsorships/cancellation/subscriptionCancellation"
import { cancelSponsorSubscription } from "@/lib/sponsorships/cancellation/subscriptionCancellationRuntime"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Provider routing and provider identifiers remain behind the cancellation RPC boundary.

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const

function boundedHeader(
  request: NextRequest,
  name: string,
  maximumLength: number,
): string | null {
  const value = request.headers.get(name)?.trim()
  return value ? value.slice(0, maximumLength) : null
}

function requestContext(
  request: NextRequest,
): SubscriptionCancellationRequestContext {
  return {
    requestId: randomUUID(),
    traceId:
      boundedHeader(request, "x-vercel-id", 255) ??
      boundedHeader(request, "cf-ray", 255) ??
      boundedHeader(request, "traceparent", 255) ??
      boundedHeader(request, "x-trace-id", 255),
    clientIp:
      boundedHeader(request, "cf-connecting-ip", 256) ??
      boundedHeader(request, "x-vercel-forwarded-for", 256) ??
      boundedHeader(request, "x-forwarded-for", 256) ??
      boundedHeader(request, "x-real-ip", 256),
    userAgent: boundedHeader(request, "user-agent", 1024),
  }
}

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: RESPONSE_HEADERS,
  })
}

async function readBoundedBody(request: NextRequest): Promise<string | null> {
  const contentLength = request.headers.get("content-length")
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) > MAXIMUM_SUBSCRIPTION_CANCELLATION_BODY_BYTES)
  ) {
    return null
  }

  if (request.body === null) return null

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let receivedBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      if (receivedBytes > MAXIMUM_SUBSCRIPTION_CANCELLATION_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString("utf8")
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

export async function POST(request: NextRequest) {
  const expectedOrigin = resolveTrustedCheckoutRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    expectedOrigin === null ||
    !isTrustedCheckoutJsonRequest(request.headers, expectedOrigin)
  ) {
    return response({ error: "invalid-request" }, 400)
  }

  const serializedBody = await readBoundedBody(request)
  const cancellationRequest =
    serializedBody === null
      ? null
      : parseSubscriptionCancellationBody(serializedBody)
  if (cancellationRequest === null) {
    return response({ error: "invalid-request" }, 400)
  }

  const authenticatedClient = await createClient()
  const {
    data: { user },
    error: authenticationError,
  } = await authenticatedClient.auth.getUser()
  if (authenticationError || !user) {
    return response({ error: "unauthorized" }, 401)
  }

  try {
    const result = await cancelSponsorSubscription({
      subscriptionId: cancellationRequest.subscriptionId,
      reason: cancellationRequest.reason,
      context: requestContext(request),
      authenticatedClient,
      serviceClient: createServiceRoleClient(),
    })
    return response(
      {
        operationId: result.operationId,
        status: result.status,
        terminal: result.terminal,
      },
      result.httpStatus,
    )
  } catch (error) {
    const cancellationError =
      error instanceof SubscriptionCancellationBoundaryError
        ? error
        : new SubscriptionCancellationBoundaryError("unavailable", 503)
    return response(
      { error: cancellationError.code },
      cancellationError.httpStatus,
    )
  }
}
