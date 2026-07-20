import { NextRequest, NextResponse } from "next/server"
import { isAuthSessionMissingError } from "@supabase/supabase-js"

import {
  advocateAttributionIdentityCookieRollbackHeaders,
  resolveAdvocateAttributionIdentityCookie,
} from "@/lib/advocates/attributionIdentityCookie"
import {
  ADVOCATE_EXPOSURE_ALLOWED_PREFLIGHT_HEADERS,
  isExactActiveAdvocatePresentationSnapshot,
  readAdvocateExposureBrokerBody,
  resolveAdvocateExposureBrokerRequest,
  type AdvocateExposureBrokerRequestContext,
} from "@/lib/advocates/exposureBrokerServer"
import {
  createQualifiedExposureEventKey,
  digestSponsorshipVisitorToken,
} from "@/lib/sponsorships/exposure"
import {
  createSponsorshipVisitorToken,
  resolveSponsorshipVisitorCookie,
  sponsorshipVisitorCookieRollbackHeaders,
  sponsorshipVisitorCookieSetHeaders,
} from "@/lib/sponsorships/visitorCookie"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  Vary: "Host, Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  "X-Content-Type-Options": "nosniff",
} as const

function response(
  status: 204 | 503,
  options: {
    context?: AdvocateExposureBrokerRequestContext
    preflight?: boolean
    setCookies?: readonly string[]
  } = {},
): NextResponse {
  const result = new NextResponse(null, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  if (options.context !== undefined) {
    result.headers.set(
      "Access-Control-Allow-Origin",
      options.context.allowedOrigin,
    )
    result.headers.set("Access-Control-Allow-Credentials", "true")
    if (options.preflight) {
      result.headers.set("Access-Control-Allow-Methods", "POST")
      result.headers.set(
        "Access-Control-Allow-Headers",
        ADVOCATE_EXPOSURE_ALLOWED_PREFLIGHT_HEADERS,
      )
      result.headers.set("Access-Control-Max-Age", "600")
    }
  }
  for (const cookie of options.setCookies ?? []) {
    result.headers.append("Set-Cookie", cookie)
  }
  return result
}

function neutralResponse(): NextResponse {
  return response(204)
}

async function requireActiveAdvocateOrigin(
  context: AdvocateExposureBrokerRequestContext,
  serviceClient: ReturnType<typeof createServiceRoleClient>,
): Promise<boolean> {
  const { data, error } = await serviceClient.rpc(
    "read_public_advocate_presentation_snapshot",
    { target_hostname: context.advocateHostname },
  )
  return (
    error === null &&
    isExactActiveAdvocatePresentationSnapshot(data, context.advocateHostname)
  )
}

export async function OPTIONS(request: NextRequest) {
  const context = resolveAdvocateExposureBrokerRequest(request)
  if (context === null) return neutralResponse()

  try {
    const active = await requireActiveAdvocateOrigin(
      context,
      createServiceRoleClient({ requestTimeoutMilliseconds: 5_000 }),
    )
    return active
      ? response(204, { context, preflight: true })
      : neutralResponse()
  } catch (error) {
    console.error("Advocate exposure preflight validation failed", {
      error: error instanceof Error ? error.name : "UnknownBrokerError",
    })
    return neutralResponse()
  }
}

export async function POST(request: NextRequest) {
  const context = resolveAdvocateExposureBrokerRequest(request)
  if (context === null) return neutralResponse()
  const body = await readAdvocateExposureBrokerBody(request)
  if (body === null) return neutralResponse()

  const requestId = crypto.randomUUID()
  try {
    const serviceClient = createServiceRoleClient({
      requestTimeoutMilliseconds: 5_000,
    })
    if (!(await requireActiveAdvocateOrigin(context, serviceClient))) {
      return neutralResponse()
    }

    const cookieHeader = request.headers.get("cookie")
    const rawHost = request.headers.get("host")
    const authClient = await createClient()
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser()
    if (authError && !isAuthSessionMissingError(authError)) {
      return response(503, { context })
    }
    const identity = resolveAdvocateAttributionIdentityCookie(cookieHeader, {
      rawHost,
    })
    if (
      user?.id &&
      identity.signal?.authUserId &&
      user.id !== identity.signal.authUserId
    ) {
      return response(204, { context })
    }
    const attributionAuthUserId =
      user?.id ?? identity.signal?.authUserId ?? null

    const visitor = await resolveSponsorshipVisitorCookie(cookieHeader, {
      rawHost,
    })
    const visitorToken =
      visitor.token ?? (await createSponsorshipVisitorToken({ rawHost }))
    if (visitorToken === null) return response(503, { context })

    const setCookies = [
      ...(visitor.token === null || visitor.requiresNormalization
        ? sponsorshipVisitorCookieSetHeaders(
            visitorToken,
            rawHost,
            request.nextUrl.protocol === "https:",
          )
        : await sponsorshipVisitorCookieRollbackHeaders(
            cookieHeader,
            rawHost,
            request.nextUrl.protocol === "https:",
          )),
      ...advocateAttributionIdentityCookieRollbackHeaders(
        cookieHeader,
        rawHost,
        request.nextUrl.protocol === "https:",
      ),
    ].filter((value, index, values) => values.indexOf(value) === index)

    const visitorDigest = digestSponsorshipVisitorToken(visitorToken)
    const eventKey = createQualifiedExposureEventKey({
      visitorDigest: visitorDigest.digest,
      advocateHostname: context.advocateHostname,
      pagePath: body.pagePath,
      authUserId: attributionAuthUserId,
      observedAt: new Date(),
    })
    const { error } = await serviceClient.rpc(
      "record_qualified_advocate_exposure",
      {
        target_event_key: eventKey,
        target_visitor_token_digest: visitorDigest.digestRpcBytea,
        target_advocate_hostname: context.advocateHostname,
        target_consent_state: "not_required",
        target_page_path: body.pagePath,
        target_referrer_host: null,
        target_auth_user_id: attributionAuthUserId,
        context_request_id: requestId,
        context_trace_id: null,
      },
    )
    if (error) {
      console.error("Qualified advocate exposure recording failed", {
        code: error.code,
        requestId,
      })
      return response(503, { context, setCookies })
    }

    return response(204, { context, setCookies })
  } catch (error) {
    console.error("Qualified advocate exposure request failed", {
      error: error instanceof Error ? error.name : "UnknownExposureError",
      requestId,
    })
    return response(503, { context })
  }
}
