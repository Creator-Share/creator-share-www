import { NextResponse } from "next/server"

import {
  isPublicBeneficiaryUsername,
  parsePublicBeneficiary,
} from "@/lib/advocates/publicCatalog"
import { createServiceRolePublicCatalogRepository } from "@/lib/advocates/publicCatalogRepository"
import { createServiceRolePublicAdvocatePresentationRepository } from "@/lib/advocates/publicPresentationRepository"
import { resolvePublicSiteRequest } from "@/lib/advocates/publicSiteRequest"
import { createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Host",
  "X-Content-Type-Options": "nosniff",
} as const

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const requestId = crypto.randomUUID()

  try {
    const { username } = await params
    if (!isPublicBeneficiaryUsername(username)) {
      return json({ error: "Beneficiary not found" }, 404)
    }

    const serviceClient = createServiceRoleClient()
    const siteResolution = await resolvePublicSiteRequest({
      rawHost: request.headers.get("host"),
      repository:
        createServiceRolePublicAdvocatePresentationRepository(serviceClient),
      environment: process.env,
    })
    if (siteResolution.kind === "not-found") {
      return json({ error: "Beneficiary not found" }, 404)
    }
    if (siteResolution.kind === "operational-failure") {
      console.error("Public beneficiary site resolution failed", { requestId })
      return json({ error: "Beneficiary unavailable", requestId }, 503)
    }

    const site = siteResolution.site
    const repository = createServiceRolePublicCatalogRepository(serviceClient)
    const source =
      site.kind === "advocate"
        ? await repository.loadAdvocateBeneficiaryByUsername(
            site.canonicalHostname,
            username,
          )
        : await repository.loadPrimaryBeneficiaryByUsername(username)
    const beneficiary = parsePublicBeneficiary(source)
    if (beneficiary === null) {
      return json({ error: "Beneficiary not found" }, 404)
    }

    return json({ beneficiary })
  } catch (error) {
    console.error("Public beneficiary request failed", {
      requestId,
      errorName:
        error instanceof Error ? error.name : "UnknownBeneficiaryError",
    })
    return json({ error: "Beneficiary unavailable", requestId }, 503)
  }
}
