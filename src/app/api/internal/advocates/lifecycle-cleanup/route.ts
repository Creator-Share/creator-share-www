import { handleArchivedAdvocateDomainCleanupRequest } from "@/lib/advocates/lifecycleCleanup/route"
import { createSupabaseArchivedAdvocateDomainCleanupRpcExecutor } from "@/lib/advocates/lifecycleCleanup/repository"
import { createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

async function handle(request: Request): Promise<Response> {
  return handleArchivedAdvocateDomainCleanupRequest(request, {
    createExecutor: () =>
      createSupabaseArchivedAdvocateDomainCleanupRpcExecutor(
        createServiceRoleClient(),
      ),
  })
}

export const GET = handle
export const POST = handle
