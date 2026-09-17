import "server-only"

import { NextResponse } from "next/server"
import { resolveTrustedPrimaryRequestOrigin } from "@/lib/sponsorships/checkout/requestSecurity"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

/** Diagnostic provider calls require staff authority and a same-origin action. */
export async function requireDiagnosticAdmin(
  request: Request,
): Promise<NextResponse | null> {
  const expectedOrigin = resolveTrustedPrimaryRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  const origin = request.headers.get("origin")
  const fetchSite = request.headers.get("sec-fetch-site")
  // Same-origin GET fetches may omit Origin. Cross-site navigations must not send mail.
  const sameOrigin =
    origin === expectedOrigin ||
    (request.method === "GET" && origin === null && fetchSite === "same-origin")
  if (
    expectedOrigin === null ||
    !sameOrigin ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) {
    return NextResponse.json({ error: "Invalid diagnostic request" }, { status: 400 })
  }
  const auth = await requireSuperAdmin(await createClient())
  return auth.ok ? null : auth.response
}
