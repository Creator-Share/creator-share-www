import { type NextRequest } from "next/server"

import { handlePublicationCanaryRequest } from "@/lib/advocates/publicationCanary/challenge"
import { createServiceRolePublicationCanaryRepository } from "@/lib/advocates/publicationCanary/repository"
import { createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest): Promise<Response> {
  return handlePublicationCanaryRequest(request, {
    async loadTarget(identity) {
      return createServiceRolePublicationCanaryRepository(
        createServiceRoleClient(),
      ).loadVerifyingTarget(identity)
    },
  })
}
