import { handleAdvocateLogoReconciliationRequest } from "@/lib/advocates/logoReconciliation/route"
import { createSupabaseAdvocateLogoReconciliationRepository } from "@/lib/advocates/logoReconciliation/repository"
import { createAdvocateLogoReconciliationServiceClient } from "@/lib/advocates/logoReconciliation/serviceClient"
import { createSupabaseAdvocateLogoReconciliationStorage } from "@/lib/advocates/logoReconciliation/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

async function handle(request: Request): Promise<Response> {
  return handleAdvocateLogoReconciliationRequest(request, {
    createWorkerDependencies({ config, invocationDeadlineAt, now }) {
      const serviceClient = createAdvocateLogoReconciliationServiceClient({
        requestTimeoutMilliseconds: config.storageTimeoutMilliseconds,
        invocationDeadlineAt,
        now,
      })
      return {
        repository:
          createSupabaseAdvocateLogoReconciliationRepository(serviceClient),
        storage: createSupabaseAdvocateLogoReconciliationStorage(serviceClient),
      }
    },
  })
}

export const GET = handle
export const POST = handle
