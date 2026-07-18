import "server-only"

import { cache } from "react"
import { headers } from "next/headers"

import { createServiceRoleClient } from "@/utils/supabase/server"

import { createServiceRolePublicAdvocatePresentationRepository } from "./publicPresentationRepository"
import {
  resolvePublicSiteRequest,
  type PublicSiteRequestResolution,
} from "./publicSiteRequest"

async function loadCurrentPublicSite(): Promise<PublicSiteRequestResolution> {
  const requestHeaders = await headers()

  return resolvePublicSiteRequest({
    rawHost: requestHeaders.get("host"),
    environment: process.env,
    repository: {
      async loadByCanonicalHostname(hostname) {
        const repository =
          createServiceRolePublicAdvocatePresentationRepository(
            createServiceRoleClient(),
          )
        return repository.loadByCanonicalHostname(hostname)
      },
    },
  })
}

/**
 * React cache deduplicates the host lookup shared by metadata and the layout
 * within one request. It does not create a cross-request tenant cache.
 */
export const getCurrentPublicSiteResolution = cache(loadCurrentPublicSite)
