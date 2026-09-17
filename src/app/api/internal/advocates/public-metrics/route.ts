import { handleAdvocatePublicMetricReleaseRequest } from "@/lib/advocates/publicMetrics/releaseRoute"
import { createSupabaseAdvocatePublicMetricReleaseRpcExecutor } from "@/lib/advocates/publicMetrics/releaseRepository"
import { createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

async function handle(request: Request): Promise<Response> {
  return handleAdvocatePublicMetricReleaseRequest(request, {
    createExecutor: () =>
      createSupabaseAdvocatePublicMetricReleaseRpcExecutor(
        createServiceRoleClient(),
      ),
  })
}

export const GET = handle
export const POST = handle
