import { handlePublicationCanarySentinelWorkerRequest } from "@/lib/advocates/publicationCanary/sentinelWorker"
import {
  PUBLICATION_CANARY_SENTINEL_INVOCATION_BUDGET_MS,
  runPublicationCanarySentinelBootstrap,
} from "@/lib/advocates/publicationCanary/sentinelBootstrap"
import { createPublicationCanarySentinelEvidenceRepository } from "@/lib/advocates/publicationCanary/sentinelEvidence"
import { createPublicationCanarySentinelBootstrapRuntimeDependencies } from "@/lib/advocates/publicationCanary/runtime"
import { createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

async function handle(request: Request): Promise<Response> {
  const monotonicNow = () => performance.now()
  const deadlineAtMilliseconds =
    monotonicNow() + PUBLICATION_CANARY_SENTINEL_INVOCATION_BUDGET_MS
  return handlePublicationCanarySentinelWorkerRequest(request, {
    async runBootstrap(input) {
      const serviceRoleClient = createServiceRoleClient({
        requestTimeoutMilliseconds: 8_000,
      })
      return runPublicationCanarySentinelBootstrap(input, {
        ...createPublicationCanarySentinelBootstrapRuntimeDependencies({
          deadlineAtMilliseconds,
          monotonicNow,
        }),
        evidence:
          createPublicationCanarySentinelEvidenceRepository(serviceRoleClient),
      })
    },
    logFailure(input) {
      console.error("ADVOCATE_PUBLICATION_SENTINEL_REQUIRES_ATTENTION", input)
    },
  })
}

export const GET = handle
export const POST = handle
