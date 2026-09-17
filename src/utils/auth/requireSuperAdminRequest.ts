import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { resolveTrustedPrimaryRequestOrigin } from "@/lib/sponsorships/checkout/requestSecurity"
import {
  requireSuperAdmin,
  type RequireSuperAdminResult,
} from "@/utils/auth/requireSuperAdmin"

/** Staff actions require exact primary-origin evidence as well as role authority. */
export async function requireSuperAdminRequest(
  supabase: SupabaseClient,
  request: Request,
): Promise<RequireSuperAdminResult> {
  const expectedOrigin = resolveTrustedPrimaryRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  const origin = request.headers.get("origin")
  const fetchSite = request.headers.get("sec-fetch-site")
  // Same-origin GET fetches may omit Origin. Cross-site navigations are rejected.
  const sameOrigin =
    origin === expectedOrigin ||
    (request.method === "GET" && origin === null && fetchSite === "same-origin")
  if (
    expectedOrigin === null ||
    !sameOrigin ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid administrator request" }, { status: 400 }),
    }
  }
  return requireSuperAdmin(supabase)
}
