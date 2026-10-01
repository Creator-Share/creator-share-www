import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { SupabaseRpcBytea } from "@/lib/sponsorships/crypto"

export const EMAIL_PROOF_RECIPIENT_NORMALIZATION_VERSION = 1 as const
export const EMAIL_PROOF_RECIPIENT_HMAC_KEY_VERSION = 1 as const

export type EmailProofIssuanceFlow =
  | "advocate-invitation"
  | "generic-sign-in"
  | "registration"
  | "reauthentication"
  | "initial-claim"
  | "account-claim"
  | "password-reset"
  | "creator-share-admin-invitation"

export type EmailProofIssuanceFinishDisposition = "issued" | "ambiguous"

export interface EmailProofIssuanceContext {
  requestId: string
  traceId: string | null
}

export interface EmailProofIssuanceGateInput {
  recipientDigest: SupabaseRpcBytea
  recipientNormalizationVersion: 1
  recipientHmacKeyVersion: 1
  flow: EmailProofIssuanceFlow
  operationId: string
  leaseToken: SupabaseRpcBytea
  context: EmailProofIssuanceContext
}

export type EmailProofIssuanceGateAcquisition =
  | Readonly<{ status: "acquired"; retryAfterSeconds: 0 }>
  | Readonly<{
      status: "coalesced" | "deferred"
      retryAfterSeconds: number
    }>

export type EmailProofIssuanceGateStage =
  "acquire" | "begin" | "finish" | "abandon"

export class EmailProofIssuanceGateError extends Error {
  readonly stage: EmailProofIssuanceGateStage
  readonly transportFailure: boolean

  constructor(
    stage: EmailProofIssuanceGateStage,
    options: { transportFailure?: boolean } = {},
  ) {
    super(`email_proof_issuance_gate_${stage}_failed`)
    this.name = "EmailProofIssuanceGateError"
    this.stage = stage
    this.transportFailure = options.transportFailure === true
  }
}

export interface EmailProofIssuanceGateRepository {
  acquire(
    input: EmailProofIssuanceGateInput,
  ): Promise<EmailProofIssuanceGateAcquisition>
  begin(input: EmailProofIssuanceGateInput): Promise<void>
  finish(
    input: EmailProofIssuanceGateInput,
    disposition: EmailProofIssuanceFinishDisposition,
  ): Promise<void>
  abandon(input: EmailProofIssuanceGateInput): Promise<void>
}

type RpcResponse = {
  data: unknown
  error: unknown
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ZERO_UUID = "00000000-0000-0000-0000-000000000000"
const SHA256_RPC_BYTEA_PATTERN = /^\\x[0-9a-f]{64}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/
const EMAIL_PROOF_ISSUANCE_FLOWS = new Set<EmailProofIssuanceFlow>([
  "advocate-invitation",
  "generic-sign-in",
  "registration",
  "reauthentication",
  "initial-claim",
  "account-claim",
  "password-reset",
  "creator-share-admin-invitation",
])
const ACQUISITION_KEYS = new Set(["acquisition_result", "retry_after_seconds"])
const GATE_INPUT_KEYS = new Set([
  "recipientDigest",
  "recipientNormalizationVersion",
  "recipientHmacKeyVersion",
  "flow",
  "operationId",
  "leaseToken",
  "context",
])
const GATE_CONTEXT_KEYS = new Set(["requestId", "traceId"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function fail(
  stage: EmailProofIssuanceGateStage,
  options: { transportFailure?: boolean } = {},
): never {
  throw new EmailProofIssuanceGateError(stage, options)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.size && keys.every((key) => expected.has(key))
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    UUID_PATTERN.test(value) &&
    value.toLowerCase() !== ZERO_UUID
  )
}

function isTraceId(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value === value.trim() &&
      Buffer.byteLength(value, "utf8") >= 1 &&
      Buffer.byteLength(value, "utf8") <= 255 &&
      !CONTROL_CHARACTER_PATTERN.test(value))
  )
}

function assertGateInput(
  input: EmailProofIssuanceGateInput,
  stage: EmailProofIssuanceGateStage,
): void {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, GATE_INPUT_KEYS) ||
    !SHA256_RPC_BYTEA_PATTERN.test(input.recipientDigest) ||
    input.recipientNormalizationVersion !==
      EMAIL_PROOF_RECIPIENT_NORMALIZATION_VERSION ||
    input.recipientHmacKeyVersion !== EMAIL_PROOF_RECIPIENT_HMAC_KEY_VERSION ||
    !EMAIL_PROOF_ISSUANCE_FLOWS.has(input.flow) ||
    !isUuid(input.operationId) ||
    !SHA256_RPC_BYTEA_PATTERN.test(input.leaseToken) ||
    !isRecord(input.context) ||
    !hasExactKeys(input.context, GATE_CONTEXT_KEYS) ||
    !isUuid(input.context.requestId) ||
    !isTraceId(input.context.traceId)
  ) {
    fail(stage)
  }
}

function rpcArguments(input: EmailProofIssuanceGateInput) {
  return {
    target_recipient_digest: input.recipientDigest,
    target_recipient_normalization_version: input.recipientNormalizationVersion,
    target_recipient_hmac_key_version: input.recipientHmacKeyVersion,
    target_issuance_flow: input.flow,
    target_operation_id: input.operationId,
    target_lease_token: input.leaseToken,
    context_request_id: input.context.requestId,
    context_trace_id: input.context.traceId,
  }
}

function isTransportFailure(error: unknown): boolean {
  if (error instanceof Error) {
    if (
      error.name === "AbortError" ||
      error.name === "TimeoutError" ||
      error.name === "TypeError"
    ) {
      return true
    }
  }

  if (!isRecord(error)) return true
  const code = error.code
  if (typeof code === "string" && code.length > 0) {
    return !SQLSTATE_PATTERN.test(code) && !code.startsWith("PGRST")
  }

  const message = error.message
  return (
    typeof message === "string" &&
    /(?:abort|fetch|network|socket|timeout|timed out)/i.test(message)
  )
}

async function invokeRpc(
  client: SupabaseClient,
  stage: EmailProofIssuanceGateStage,
  name: string,
  args: Record<string, unknown>,
): Promise<RpcResponse> {
  let response: unknown
  try {
    response = await client.rpc(name, args)
  } catch {
    fail(stage, { transportFailure: true })
  }

  if (!isRecord(response) || !("data" in response) || !("error" in response)) {
    fail(stage)
  }

  const result = response as RpcResponse
  if (result.error !== null) {
    fail(stage, { transportFailure: isTransportFailure(result.error) })
  }
  return result
}

function parseAcquisition(data: unknown): EmailProofIssuanceGateAcquisition {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    fail("acquire")
  }

  const row = data[0]
  const keys = Object.keys(row)
  if (
    keys.length !== ACQUISITION_KEYS.size ||
    keys.some((key) => !ACQUISITION_KEYS.has(key))
  ) {
    fail("acquire")
  }

  const status = row.acquisition_result
  const retryAfterSeconds = row.retry_after_seconds
  if (
    (status !== "acquired" &&
      status !== "coalesced" &&
      status !== "deferred") ||
    typeof retryAfterSeconds !== "number" ||
    !Number.isSafeInteger(retryAfterSeconds) ||
    retryAfterSeconds < 0 ||
    retryAfterSeconds > 3900 ||
    (status === "acquired" && retryAfterSeconds !== 0) ||
    (status === "deferred" && retryAfterSeconds < 1)
  ) {
    fail("acquire")
  }

  if (status === "acquired") {
    return Object.freeze({ status, retryAfterSeconds: 0 })
  }
  return Object.freeze({ status, retryAfterSeconds })
}

async function invokeVoidRpc(
  client: SupabaseClient,
  stage: Exclude<EmailProofIssuanceGateStage, "acquire">,
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  const response = await invokeRpc(client, stage, name, args)
  if (response.data !== null) fail(stage)
}

export function createEmailProofIssuanceGateRepository(
  client: SupabaseClient,
): EmailProofIssuanceGateRepository {
  if (!client || typeof client.rpc !== "function") {
    throw new EmailProofIssuanceGateError("acquire")
  }

  const repository: EmailProofIssuanceGateRepository = {
    async acquire(input) {
      assertGateInput(input, "acquire")
      const response = await invokeRpc(
        client,
        "acquire",
        "acquire_email_proof_issuance_gate",
        rpcArguments(input),
      )
      return parseAcquisition(response.data)
    },

    async begin(input) {
      assertGateInput(input, "begin")
      await invokeVoidRpc(
        client,
        "begin",
        "begin_email_proof_issuance",
        rpcArguments(input),
      )
    },

    async finish(input, disposition) {
      assertGateInput(input, "finish")
      if (disposition !== "issued" && disposition !== "ambiguous") {
        fail("finish")
      }
      await invokeVoidRpc(client, "finish", "finish_email_proof_issuance", {
        ...rpcArguments(input),
        target_finish_disposition: disposition,
      })
    },

    async abandon(input) {
      assertGateInput(input, "abandon")
      await invokeVoidRpc(
        client,
        "abandon",
        "abandon_email_proof_issuance",
        rpcArguments(input),
      )
    },
  }
  return Object.freeze(repository)
}
