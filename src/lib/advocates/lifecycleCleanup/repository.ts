import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { ArchivedAdvocateDomainCleanupRpcExecutor } from "./worker"

interface RpcResult {
  data: unknown
  error: unknown
}

interface RpcBuilder {
  abortSignal(signal: AbortSignal): PromiseLike<RpcResult>
}

export function createSupabaseArchivedAdvocateDomainCleanupRpcExecutor(
  client: SupabaseClient,
): ArchivedAdvocateDomainCleanupRpcExecutor {
  return {
    async coordinate(batchSize, coordinatorId, signal): Promise<unknown> {
      const builder = client.rpc(
        "coordinate_archived_advocate_domain_deprovisioning",
        {
          batch_size: batchSize,
          coordinator_id: coordinatorId,
        },
      ) as unknown as RpcBuilder
      const { data, error } = await builder.abortSignal(signal)
      if (error) {
        throw new Error("Archived advocate domain cleanup RPC failed")
      }
      return data
    },
  }
}
