import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  AdvocatePublicMetricReleaseRpcExecutor,
  AdvocatePublicMetricReleaseWorkerContext,
} from "./releaseWorker"

interface RpcResult {
  data: unknown
  error: unknown
}

interface RpcBuilder {
  abortSignal(signal: AbortSignal): PromiseLike<RpcResult>
}

export function createSupabaseAdvocatePublicMetricReleaseRpcExecutor(
  client: SupabaseClient,
): AdvocatePublicMetricReleaseRpcExecutor {
  return {
    async refresh(
      batchSize: number,
      context: AdvocatePublicMetricReleaseWorkerContext,
      signal: AbortSignal,
    ): Promise<unknown> {
      const builder = client.rpc("refresh_advocate_public_metric_releases", {
        batch_limit: batchSize,
        request_id: context.requestId,
        trace_id: context.traceId,
      }) as unknown as RpcBuilder
      const { data, error } = await builder.abortSignal(signal)
      if (error) {
        throw new Error("Advocate public metric release RPC failed")
      }
      return data
    },
  }
}
