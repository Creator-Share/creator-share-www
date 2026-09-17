import { createAdvocateInvitationInterstitial } from "@/lib/advocates/invitations/interstitial"
import { ADVOCATE_INVITATION_PATH } from "@/lib/advocates/invitations/material"
import { resolveTrustedAdvocateInvitationOrigin } from "@/lib/advocates/invitations/routeSecurity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DENIED_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const

export async function GET(request: Request) {
  let target: URL
  try {
    target = new URL(request.url)
  } catch {
    return new Response(null, { status: 404, headers: DENIED_HEADERS })
  }
  if (
    request.url.includes("#") ||
    target.pathname !== ADVOCATE_INVITATION_PATH ||
    target.search !== "" ||
    resolveTrustedAdvocateInvitationOrigin({
      rawHost: request.headers.get("host"),
    }) === null
  ) {
    return new Response(null, { status: 404, headers: DENIED_HEADERS })
  }
  const interstitial = createAdvocateInvitationInterstitial()
  return new Response(interstitial.html, {
    status: 200,
    headers: interstitial.headers,
  })
}

export async function HEAD(request: Request) {
  const response = await GET(request)
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  })
}
