import { NextRequest, NextResponse } from "next/server"

import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedPrimaryRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import {
  createSponsorPaymentMethodDestinationFromRuntime,
  MAXIMUM_PAYMENT_METHOD_MANAGEMENT_BODY_BYTES,
  parsePaymentMethodManagementBody,
  PaymentMethodManagementError,
} from "@/lib/sponsorships/management/paymentMethod"
import { readBoundedSponsorManagementBody } from "@/lib/sponsorships/management/passwordlessAccess"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  Vary: "Host, Origin, Cookie",
  "X-Content-Type-Options": "nosniff",
} as const

function response(body: object, status: number) {
  return NextResponse.json(body, {
    status,
    headers: RESPONSE_HEADERS,
  })
}

export async function POST(request: NextRequest) {
  const expectedOrigin = resolveTrustedPrimaryRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    expectedOrigin === null ||
    !isTrustedCheckoutJsonRequest(request.headers, expectedOrigin)
  ) {
    return response({ error: "invalid-request" }, 400)
  }

  const serializedBody = await readBoundedSponsorManagementBody(
    request,
    MAXIMUM_PAYMENT_METHOD_MANAGEMENT_BODY_BYTES,
  )
  const paymentMethodRequest =
    serializedBody === null
      ? null
      : parsePaymentMethodManagementBody(serializedBody)
  if (paymentMethodRequest === null) {
    return response({ error: "invalid-request" }, 400)
  }

  let authenticatedClient: Awaited<ReturnType<typeof createClient>>
  try {
    authenticatedClient = await createClient()
  } catch {
    return response({ error: "unavailable" }, 503)
  }

  let authentication: Awaited<
    ReturnType<typeof authenticatedClient.auth.getUser>
  >
  try {
    authentication = await authenticatedClient.auth.getUser()
  } catch {
    return response({ error: "unavailable" }, 503)
  }
  const {
    data: { user },
    error: authenticationError,
  } = authentication
  if (authenticationError || !user) {
    return response({ error: "unauthorized" }, 401)
  }

  try {
    const destination = await createSponsorPaymentMethodDestinationFromRuntime({
      accountId: user.id,
      subscriptionId: paymentMethodRequest.subscriptionId,
      authenticatedClient,
      serviceClient: createServiceRoleClient(),
    })
    return response(destination, 200)
  } catch (error) {
    const managementError =
      error instanceof PaymentMethodManagementError
        ? error
        : new PaymentMethodManagementError("unavailable", 503)
    return response({ error: managementError.code }, managementError.httpStatus)
  }
}
