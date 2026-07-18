import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import { isPayPalEnabled } from "@/lib/paypal/client"
import {
  capturePayPalSponsorshipCheckoutV2,
  createPayPalSponsorshipCheckoutV2,
} from "@/lib/sponsorships/checkout/paypalCheckout"
import {
  createCapturePayPalSponsorshipDependencies,
  createPayPalSponsorshipCheckoutV2Dependencies,
  PayPalCheckoutRuntimeError,
} from "@/lib/sponsorships/checkout/paypalCheckoutRuntime"
import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedCheckoutRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import {
  checkoutError,
  readSponsorshipVisitorCookie,
  resolveSponsorshipCheckoutHost,
  SponsorshipCheckoutError,
  type SponsorshipCheckoutRequestContext,
} from "@/lib/sponsorships/checkout/stripeCheckout"
import { PayPalBillingCatalogProvisioningError } from "@/lib/paypal/billingCatalogProvisioner"
import { PayPalSponsorshipCheckoutError } from "@/lib/paypal/sponsorshipCheckout"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"

const MAXIMUM_REQUEST_BYTES = 16 * 1024
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  Vary: "Host, Origin, Cookie",
  "X-Content-Type-Options": "nosniff",
} as const

function boundedHeader(
  request: Request,
  headerName: string,
  maximumLength: number,
): string | null {
  const value = request.headers.get(headerName)?.trim()
  return value ? value.slice(0, maximumLength) : null
}

function requestContext(request: Request): SponsorshipCheckoutRequestContext {
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

function configuredHostname(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(
      value.includes("://") ? value : `https://${value}`,
    ).hostname.toLowerCase()
  } catch {
    return null
  }
}

function allowedPrimaryHostnames(): Set<string> {
  return new Set(
    [
      "creator-share-www.vercel.app",
      configuredHostname(process.env.NEXT_PUBLIC_BASE_URL),
      configuredHostname(process.env.NEXT_PUBLIC_SITE_URL),
      configuredHostname(process.env.VERCEL_URL),
    ].filter((value): value is string => Boolean(value)),
  )
}

async function authenticatedCheckoutUser() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user?.email || !user.email_confirmed_at) return null
  return { id: user.id, email: user.email }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function captureBody(value: Record<string, unknown>): {
  operationId: string
  checkoutReceipt: string
} {
  if (
    Object.keys(value).length !== 3 ||
    value.action !== "capture" ||
    typeof value.checkoutRequestId !== "string" ||
    typeof value.checkoutReceipt !== "string"
  ) {
    throw checkoutError("invalid-request")
  }
  return {
    operationId: value.checkoutRequestId,
    checkoutReceipt: value.checkoutReceipt,
  }
}

function safeCheckoutError(error: unknown): SponsorshipCheckoutError {
  if (error instanceof SponsorshipCheckoutError) return error
  if (error instanceof PayPalCheckoutRuntimeError) {
    switch (error.databaseCode) {
      case "22023":
      case "22P02":
        return checkoutError("invalid-request")
      case "23503":
      case "23505":
      case "23514":
      case "55P03":
        return checkoutError("sponsorship-unavailable")
      default:
        return checkoutError("checkout-failed")
    }
  }
  if (error instanceof PayPalBillingCatalogProvisioningError) {
    return error.code === "catalog-unavailable" ||
      error.code === "provider-rejected"
      ? checkoutError("sponsorship-unavailable")
      : checkoutError("checkout-failed")
  }
  if (error instanceof PayPalSponsorshipCheckoutError) {
    return error.code === "invalid-request"
      ? checkoutError("invalid-request")
      : checkoutError("checkout-failed")
  }
  return checkoutError("checkout-failed")
}

async function readBody(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(contentLength) && contentLength > MAXIMUM_REQUEST_BYTES) {
    throw new SponsorshipCheckoutError(
      "invalid-request",
      "Checkout request is too large",
      413,
    )
  }
  const serialized = await request.text()
  if (Buffer.byteLength(serialized, "utf8") > MAXIMUM_REQUEST_BYTES) {
    throw new SponsorshipCheckoutError(
      "invalid-request",
      "Checkout request is too large",
      413,
    )
  }
  try {
    return JSON.parse(serialized) as unknown
  } catch {
    throw checkoutError("invalid-request")
  }
}

export async function POST(request: Request) {
  const context = requestContext(request)
  const expectedOrigin = resolveTrustedCheckoutRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    !expectedOrigin ||
    !isTrustedCheckoutJsonRequest(request.headers, expectedOrigin)
  ) {
    return NextResponse.json(
      { error: "Invalid checkout request" },
      { status: 400, headers: RESPONSE_HEADERS },
    )
  }
  if (!isPayPalEnabled()) {
    return NextResponse.json(
      { error: "PayPal checkout is unavailable" },
      { status: 503, headers: RESPONSE_HEADERS },
    )
  }

  try {
    const body = await readBody(request)
    if (!isRecord(body)) throw checkoutError("invalid-request")
    const host = resolveSponsorshipCheckoutHost(request.headers.get("host"), {
      allowLocalhostDevelopment: process.env.NODE_ENV !== "production",
      allowedPrimaryHostnames: allowedPrimaryHostnames(),
    })
    const serviceClient = createServiceRoleClient()

    if (body.action === "capture") {
      const capture = captureBody(body)
      const result = await capturePayPalSponsorshipCheckoutV2(
        { ...capture, host, requestContext: context },
        createCapturePayPalSponsorshipDependencies(serviceClient),
      )
      return NextResponse.json(
        {
          checkoutReceipt: result.checkoutReceipt,
          processing: true,
          replayed: result.replayed,
          url: result.statusUrl,
        },
        { headers: RESPONSE_HEADERS },
      )
    }

    const result = await createPayPalSponsorshipCheckoutV2(
      {
        body,
        host,
        authenticatedUser: await authenticatedCheckoutUser(),
        visitorToken: await readSponsorshipVisitorCookie(
          request.headers.get("cookie"),
        ),
        requestContext: context,
      },
      createPayPalSponsorshipCheckoutV2Dependencies(serviceClient),
    )
    if (result.kind === "order") {
      return NextResponse.json(
        {
          checkoutReceipt: result.checkoutReceipt,
          orderID: result.orderId,
        },
        { headers: RESPONSE_HEADERS },
      )
    }
    if (result.kind === "approval_redirect") {
      return NextResponse.json(
        {
          approvalUrl: result.approvalUrl,
          checkoutReceipt: result.checkoutReceipt,
        },
        { headers: RESPONSE_HEADERS },
      )
    }
    return NextResponse.json(
      {
        checkoutReceipt: result.checkoutReceipt,
        processing: true,
        url: result.statusUrl,
      },
      { headers: RESPONSE_HEADERS },
    )
  } catch (error) {
    const safeError = safeCheckoutError(error)
    console.error("PayPal sponsorship checkout failed", {
      code: safeError.code,
      requestId: context.requestId,
    })
    return NextResponse.json(
      { error: safeError.message },
      { status: safeError.httpStatus, headers: RESPONSE_HEADERS },
    )
  }
}
