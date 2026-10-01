import { handleDataRetentionRequest } from "@/lib/retention/dataRetentionRoute"
import { createSupabaseDataRetentionRpcExecutor } from "@/lib/retention/dataRetentionRepository"
import { createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function handle(request: Request) {
  return handleDataRetentionRequest(request, {
    createExecutor: () =>
      createSupabaseDataRetentionRpcExecutor(createServiceRoleClient()),
  })
}

export const GET = handle
export const POST = handle
