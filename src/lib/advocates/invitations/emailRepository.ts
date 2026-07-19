import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { SupabaseRpcBytea } from "@/lib/sponsorships/crypto"
import type { AdvocateInvitationEmailTemplateKey } from "./emailEnvelope"

import {
  AdvocateInvitationEmailRepositoryError,
  type AdvocateInvitationEmailRepository,
  type ClaimedAdvocateInvitationEmail,
} from "./emailWorker"

interface SupabaseErrorLike {
  code?: string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const LEASE_TOKEN_PATTERN = /^[0-9a-f]{64}$/
const RPC_BYTEA_PATTERN = /^\\x(?:[0-9a-f]{2})+$/
const CLAIM_KEYS = new Set([
  "outbox_id",
  "invitation_id",
  "advocate_id",
  "lease_token",
  "lease_expires_at",
  "target_auth_user_id",
  "template_key",
  "template_data",
  "recipient_email_ciphertext",
  "recipient_email_hmac",
  "secret_payload_ciphertext",
  "capability_digest",
  "email_normalization_version",
  "email_hmac_key_version",
  "email_encryption_key_version",
  "provider_idempotency_key",
  "attempt_count",
])

function repositoryError(
  stage: string,
  error: SupabaseErrorLike | null = null,
): never {
  throw new AdvocateInvitationEmailRepositoryError(stage, {
    leaseLost: error?.code === "55P03",
    targetUnavailable: stage === "bind" && error?.code === "42501",
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function oneRow(data: unknown, stage: string): Record<string, unknown> {
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data
  if (!isRecord(row)) repositoryError(`${stage}_shape`)
  return row
}

function requiredString(
  row: Record<string, unknown>,
  key: string,
  maximumLength: number,
  stage: string,
): string {
  const value = row[key]
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim()
  ) {
    repositoryError(`${stage}_shape`)
  }
  return value
}

function requiredUuid(
  row: Record<string, unknown>,
  key: string,
  stage: string,
): string {
  const value = requiredString(row, key, 36, stage)
  if (!UUID_PATTERN.test(value)) repositoryError(`${stage}_shape`)
  return value
}

function optionalUuid(
  row: Record<string, unknown>,
  key: string,
  stage: string,
): string | null {
  if (row[key] === null) return null
  return requiredUuid(row, key, stage)
}

function requiredInteger(
  row: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
  stage: string,
): number {
  const raw = row[key]
  const value = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    repositoryError(`${stage}_shape`)
  }
  return value
}

function requiredRpcBytea(
  row: Record<string, unknown>,
  key: string,
  minimumBytes: number,
  maximumBytes: number,
  stage: string,
): SupabaseRpcBytea {
  const value = row[key]
  const byteLength =
    typeof value === "string" && RPC_BYTEA_PATTERN.test(value)
      ? (value.length - 2) / 2
      : 0
  if (byteLength < minimumBytes || byteLength > maximumBytes) {
    repositoryError(`${stage}_shape`)
  }
  return value as SupabaseRpcBytea
}

function parseClaimedJob(value: unknown): ClaimedAdvocateInvitationEmail {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== CLAIM_KEYS.size ||
    Object.keys(value).some((key) => !CLAIM_KEYS.has(key))
  ) {
    repositoryError("claim_shape")
  }
  const leaseToken = requiredString(value, "lease_token", 64, "claim")
  const leaseExpiresAt = requiredString(value, "lease_expires_at", 64, "claim")
  const templateKey = requiredString(value, "template_key", 80, "claim")
  const providerIdempotencyKey = requiredString(
    value,
    "provider_idempotency_key",
    255,
    "claim",
  )
  if (
    !LEASE_TOKEN_PATTERN.test(leaseToken) ||
    !Number.isFinite(Date.parse(leaseExpiresAt)) ||
    (templateKey !== "advocate_delegate_invitation_v1" &&
      templateKey !== "advocate_initial_owner_invitation_v1") ||
    !isRecord(value.template_data) ||
    !/^advocate-invitation:[0-9a-f-]{36}$/.test(providerIdempotencyKey)
  ) {
    repositoryError("claim_shape")
  }

  return {
    outboxId: requiredUuid(value, "outbox_id", "claim"),
    invitationId: requiredUuid(value, "invitation_id", "claim"),
    advocateId: requiredUuid(value, "advocate_id", "claim"),
    leaseToken,
    leaseExpiresAt,
    targetAuthUserId: optionalUuid(value, "target_auth_user_id", "claim"),
    templateKey: templateKey as AdvocateInvitationEmailTemplateKey,
    templateData: value.template_data,
    recipientEmailCiphertext: requiredRpcBytea(
      value,
      "recipient_email_ciphertext",
      32,
      4_096,
      "claim",
    ),
    recipientEmailHmac: requiredRpcBytea(
      value,
      "recipient_email_hmac",
      32,
      32,
      "claim",
    ),
    secretPayloadCiphertext: requiredRpcBytea(
      value,
      "secret_payload_ciphertext",
      32,
      16_384,
      "claim",
    ),
    capabilityDigest: requiredRpcBytea(
      value,
      "capability_digest",
      32,
      32,
      "claim",
    ),
    emailNormalizationVersion: requiredInteger(
      value,
      "email_normalization_version",
      1,
      32_767,
      "claim",
    ),
    emailHmacKeyVersion: requiredInteger(
      value,
      "email_hmac_key_version",
      1,
      32_767,
      "claim",
    ),
    emailEncryptionKeyVersion: requiredInteger(
      value,
      "email_encryption_key_version",
      1,
      32_767,
      "claim",
    ),
    providerIdempotencyKey,
    attemptCount: requiredInteger(value, "attempt_count", 1, 8, "claim"),
  }
}

export function createSupabaseAdvocateInvitationEmailRepository(
  client: SupabaseClient,
): AdvocateInvitationEmailRepository {
  return {
    async claimJobs({ workerId, batchSize, context }) {
      const { data, error } = await client.rpc(
        "claim_advocate_invitation_email_jobs",
        {
          worker_id: workerId,
          batch_size: batchSize,
          request_id: context.requestId,
          trace_id: context.traceId,
        },
      )
      if (error) repositoryError("claim", error)
      if (!Array.isArray(data)) repositoryError("claim_shape")
      if (data.length > batchSize) repositoryError("claim_cardinality")
      const jobs = data.map(parseClaimedJob)
      if (new Set(jobs.map((job) => job.outboxId)).size !== jobs.length) {
        repositoryError("claim_duplicate")
      }
      return jobs
    },

    async bindTarget(options) {
      const { data, error } = await client.rpc(
        "bind_advocate_invitation_email_target",
        {
          target_outbox_id: options.job.outboxId,
          lease_token: options.job.leaseToken,
          target_user_id: options.targetUserId,
          verified_recipient_email_hmac: options.verifiedRecipientEmailHmac,
          verified_capability_digest: options.verifiedCapabilityDigest,
          request_id: options.context.requestId,
          trace_id: options.context.traceId,
        },
      )
      if (error) repositoryError("bind", error)
      if (data !== true) repositoryError("bind_shape")
    },

    async beginDelivery(options) {
      const { data, error } = await client.rpc(
        "begin_advocate_invitation_email_delivery",
        {
          target_outbox_id: options.job.outboxId,
          lease_token: options.job.leaseToken,
          verified_recipient_email_hmac: options.verifiedRecipientEmailHmac,
          verified_capability_digest: options.verifiedCapabilityDigest,
          request_id: options.context.requestId,
          trace_id: options.context.traceId,
        },
      )
      if (error) repositoryError("begin", error)
      if (
        typeof data !== "string" ||
        data !== data.trim() ||
        data.length < 1 ||
        data.length > 255
      ) {
        repositoryError("begin_shape")
      }
      return { providerIdempotencyKey: data }
    },

    async settleDelivery(options) {
      const { data, error } = await client.rpc(
        "settle_advocate_invitation_email_delivery",
        {
          target_outbox_id: options.job.outboxId,
          lease_token: options.job.leaseToken,
          delivery_outcome: options.outcome,
          provider_message_id: options.providerMessageId,
          error_code: options.errorCode,
          retry_after_seconds: options.retryAfterSeconds,
          request_id: options.context.requestId,
          trace_id: options.context.traceId,
        },
      )
      if (error) repositoryError("settle", error)
      const row = oneRow(data, "settle")
      if (
        (row.status !== "sent" && row.status !== "failed") ||
        typeof row.retryable !== "boolean" ||
        typeof row.settled_at !== "string" ||
        !Number.isFinite(Date.parse(row.settled_at))
      ) {
        repositoryError("settle_shape")
      }
      return { status: row.status, retryable: row.retryable }
    },

    async failDelivery(options) {
      const { data, error } = await client.rpc(
        "fail_advocate_invitation_email_delivery",
        {
          target_outbox_id: options.job.outboxId,
          lease_token: options.job.leaseToken,
          error_code: options.errorCode,
          retry_after_seconds: options.retryAfterSeconds,
          request_id: options.context.requestId,
          trace_id: options.context.traceId,
        },
      )
      if (error) repositoryError("fail", error)
      if (typeof data !== "boolean") repositoryError("fail_shape")
      return { retryable: data }
    },
  }
}
