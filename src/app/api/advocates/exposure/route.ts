import { NextRequest, NextResponse } from "next/server"

import { resolveAdvocateHost } from "@/lib/advocates/host"
import {
  createQualifiedExposureEventKey,
  digestSponsorshipVisitorToken,
  getQualifiedExposureContext,
  shouldRejectExposureRequest,
} from "@/lib/sponsorships/exposure"
import { readSponsorshipVisitorCookie } from "@/lib/sponsorships/visitorCookie"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"

const NO_CONTENT = {
  status: 204,
  headers: {
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    Vary: "Host, Cookie",
    "X-Content-Type-Options": "nosniff",
  },
} as const

function noContent() {
  return new NextResponse(null, NO_CONTENT)
}

export async function POST(request: NextRequest) {
  const host = resolveAdvocateHost(request.headers.get("host"), {
    allowLocalhostDevelopment: process.env.NODE_ENV === "development",
  })
  if (host.kind !== "tenant-candidate") return noContent()
  const localPort = host.requestPort === null ? "" : `:${host.requestPort}`
  const expectedOrigin =
    host.environment === "local-development"
      ? `http://${host.requestHostname}${localPort}`
      : `https://${host.requestHostname}`
  if (shouldRejectExposureRequest(request.headers, expectedOrigin)) {
    return noContent()
  }

  const context = getQualifiedExposureContext(
    request.headers.get("referer"),
    host.requestHostname,
    host.requestPort,
  )
  if (!context) return noContent()

  const visitorToken = await readSponsorshipVisitorCookie(
    request.headers.get("cookie"),
  )
  if (!visitorToken) return noContent()

  try {
    const visitor = digestSponsorshipVisitorToken(visitorToken)
    const authClient = await createClient()
    const {
      data: { user },
    } = await authClient.auth.getUser()
    const eventKey = createQualifiedExposureEventKey({
      visitorDigest: visitor.digest,
      advocateHostname: host.domainLookup.hostname,
      pagePath: context.pagePath,
      authUserId: user?.id || null,
      observedAt: new Date(),
    })
    const requestId = crypto.randomUUID()

    const serviceClient = createServiceRoleClient()
    const { error } = await serviceClient.rpc(
      "record_qualified_advocate_exposure",
      {
        target_event_key: eventKey,
        target_visitor_token_digest: visitor.digestRpcBytea,
        target_advocate_hostname: host.domainLookup.hostname,
        target_consent_state: "not_required",
        target_page_path: context.pagePath,
        target_referrer_host: context.referrerHost,
        target_auth_user_id: user?.id || null,
        context_request_id: requestId,
        context_trace_id: null,
      },
    )

    if (error) {
      console.error("Qualified advocate exposure recording failed", {
        code: error.code,
        requestId,
      })
    }
  } catch (error) {
    console.error("Qualified advocate exposure request failed", {
      error: error instanceof Error ? error.name : "UnknownExposureError",
    })
  }

  return noContent()
}
