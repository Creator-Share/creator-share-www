import { NextResponse } from "next/server"

import {
  isPublicBeneficiaryId,
  parsePublicBeneficiaryMedia,
} from "@/lib/advocates/publicCatalog"
import { createServiceRolePublicCatalogRepository } from "@/lib/advocates/publicCatalogRepository"
import { createServiceRolePublicAdvocatePresentationRepository } from "@/lib/advocates/publicPresentationRepository"
import { resolvePublicSiteRequest } from "@/lib/advocates/publicSiteRequest"
import { filterExistingMediaRows } from "@/utils/supabase/media"
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
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID()

  try {
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
      console.error("Public beneficiary media site resolution failed", {
        requestId,
      })
      return json({ error: "Beneficiary media unavailable", requestId }, 503)
    }

    const site = siteResolution.site
    const { id } = await params
    if (!isPublicBeneficiaryId(id)) {
      return site.kind === "advocate"
        ? json({ error: "Beneficiary not found" }, 404)
        : json([])
    }

    const repository = createServiceRolePublicCatalogRepository(serviceClient)
    const source =
      site.kind === "advocate"
        ? await repository.loadAdvocateBeneficiaryMediaById(
            site.canonicalHostname,
            id,
          )
        : await repository.loadPrimaryBeneficiaryMediaById(id)
    const media = parsePublicBeneficiaryMedia(source, id)
    if (media === null) {
      return site.kind === "advocate"
        ? json({ error: "Beneficiary not found" }, 404)
        : json([])
    }

    const existingMedia = await filterExistingMediaRows(serviceClient, media)
    return json(existingMedia)
  } catch (error) {
    console.error("Public beneficiary media request failed", {
      requestId,
      errorName: error instanceof Error ? error.name : "UnknownMediaError",
    })
    return json({ error: "Beneficiary media unavailable", requestId }, 503)
  }
}
