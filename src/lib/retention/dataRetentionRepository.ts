import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  DataRetentionRpcExecutor,
  DataRetentionStepKey,
  DataRetentionWorkerContext,
} from "@/lib/retention/dataRetentionWorker"

interface RetentionRpcResult {
  data: unknown
  error: unknown
}

interface RetentionRpcBuilder {
  abortSignal(signal: AbortSignal): PromiseLike<RetentionRpcResult>
}

type RetentionRpcName =
  | "start_data_retention_run"
  | "run_data_retention_step"
  | "finish_data_retention_run"

async function executeRpc(
  client: SupabaseClient,
  rpcName: RetentionRpcName,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  const builder = client.rpc(rpcName, args) as unknown as RetentionRpcBuilder
  const { data, error } = await builder.abortSignal(signal)
  if (error) throw new Error("Data retention RPC failed")
  return data
}

function contextArguments(context: DataRetentionWorkerContext) {
  return {
    run_id: context.runId,
    request_id: context.requestId,
    trace_id: context.traceId,
  }
}

export function createSupabaseDataRetentionRpcExecutor(
  client: SupabaseClient,
): DataRetentionRpcExecutor {
  return {
    startRun(batchSize, signal, context) {
      return executeRpc(
        client,
        "start_data_retention_run",
        {
          ...contextArguments(context),
          batch_size: batchSize,
        },
        signal,
      )
    },

    executeStep(stepKey: DataRetentionStepKey, batchSize, signal, context) {
      return executeRpc(
        client,
        "run_data_retention_step",
        {
          ...contextArguments(context),
          step_key: stepKey,
          batch_size: batchSize,
        },
        signal,
      )
    },

    finishRun(reportedFailedSteps, signal, context) {
      return executeRpc(
        client,
        "finish_data_retention_run",
        {
          ...contextArguments(context),
          reported_failed_steps: reportedFailedSteps,
        },
        signal,
      )
    },
  }
}
