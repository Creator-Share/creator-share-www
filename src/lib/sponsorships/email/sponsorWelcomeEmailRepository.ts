import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { SupabaseRpcBytea } from "@/lib/sponsorships/crypto"
import {
  type ClaimedSponsorWelcomeEmail,
  SponsorWelcomeEmailRepositoryError,
  type SponsorWelcomeEmailRepository,
} from "@/lib/sponsorships/email/sponsorWelcomeEmailWorker"

interface SupabaseErrorLike {
  code?: string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const LEASE_TOKEN_PATTERN = /^[0-9a-f]{64}$/
const RPC_BYTEA_PATTERN = /^\\x(?:[0-9a-f]{2})+$/

function repositoryError(
  stage: string,
  error: SupabaseErrorLike | null = null,
): never {
  throw new SponsorWelcomeEmailRepositoryError(stage, {
    leaseLost: error?.code === "55P03",
    materialInvalid: error?.code === "23514",
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function oneRow(data: unknown, stage: string): Record<string, unknown> {
  const value = Array.isArray(data)
    ? data.length === 1
      ? data[0]
      : null
    : data
  if (!isRecord(value)) repositoryError(`${stage}_shape`)
  return value
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
  maximumBytes: number,
  stage: string,
): SupabaseRpcBytea {
  const value = row[key]
  if (
    typeof value !== "string" ||
    !RPC_BYTEA_PATTERN.test(value) ||
    (value.length - 2) / 2 > maximumBytes
  ) {
    repositoryError(`${stage}_shape`)
  }
  return value as SupabaseRpcBytea
}

function parseClaimedJob(value: unknown): ClaimedSponsorWelcomeEmail {
  if (!isRecord(value)) repositoryError("claim_shape")

  const leaseToken = requiredString(value, "lease_token", 64, "claim")
  const leaseExpiresAt = requiredString(value, "lease_expires_at", 64, "claim")
  const kind = requiredString(value, "kind", 80, "claim")
  const templateKey = requiredString(value, "template_key", 120, "claim")
  if (
    !LEASE_TOKEN_PATTERN.test(leaseToken) ||
    !Number.isFinite(Date.parse(leaseExpiresAt)) ||
    kind !== "sponsor_welcome" ||
    templateKey !== "sponsor-welcome-v1" ||
    !isRecord(value.template_data)
  ) {
    repositoryError("claim_shape")
  }

  return {
    outboxId: requiredUuid(value, "outbox_id", "claim"),
    leaseToken,
    leaseExpiresAt,
    kind,
    templateKey,
    templateData: value.template_data,
    recipientEmailCiphertext: requiredRpcBytea(
      value,
      "recipient_email_ciphertext",
      4096,
      "claim",
    ),
    secretPayloadCiphertext: requiredRpcBytea(
      value,
      "secret_payload_ciphertext",
      4096,
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
  }
}

export function createSupabaseSponsorWelcomeEmailRepository(
  client: SupabaseClient,
): SponsorWelcomeEmailRepository {
  return {
    async claimJobs({ workerId, batchSize }) {
      const { data, error } = await client.rpc("claim_email_outbox_jobs", {
        worker_id: workerId,
        batch_size: batchSize,
      })
      if (error) repositoryError("claim", error)
      if (!Array.isArray(data)) repositoryError("claim_shape")
      if (data.length > batchSize) repositoryError("claim_cardinality")
      const jobs = data.map(parseClaimedJob)
      if (new Set(jobs.map((job) => job.outboxId)).size !== jobs.length) {
        repositoryError("claim_duplicate")
      }
      return jobs
    },

    async verifyDeliveryMaterial(options) {
      const { data, error } = await client.rpc(
        "verify_email_outbox_delivery_material",
        {
          target_outbox_id: options.job.outboxId,
          target_lease_token: options.job.leaseToken,
          verified_recipient_email_hmac: options.recipientEmailHmac,
          verified_claim_token_digest: options.claimTokenDigest,
          context_request_id: options.context.requestId,
          context_trace_id: options.context.traceId,
        },
      )
      if (error) repositoryError("verify", error)
      const row = oneRow(data, "verify")
      if (
        requiredUuid(row, "outbox_id", "verify") !== options.job.outboxId ||
        typeof row.verified !== "boolean" ||
        row.verified !== true
      ) {
        repositoryError("verify_shape")
      }
      requiredUuid(row, "account_claim_id", "verify")
    },

    async beginDeliveryHandoff(options) {
      const { data, error } = await client.rpc(
        "begin_email_outbox_delivery_handoff",
        {
          target_outbox_id: options.job.outboxId,
          target_lease_token: options.job.leaseToken,
          verified_recipient_email_hmac: options.recipientEmailHmac,
          target_provider_message_id: options.providerMessageId,
          context_request_id: options.context.requestId,
          context_trace_id: options.context.traceId,
        },
      )
      if (error) repositoryError("handoff", error)
      if (
        typeof data !== "string" ||
        data.length > 64 ||
        !Number.isFinite(Date.parse(data))
      ) {
        repositoryError("handoff_shape")
      }
    },

    async completeDelivery(options) {
      const { data, error } = await client.rpc(
        "complete_email_outbox_delivery",
        {
          outbox_id: options.job.outboxId,
          lease_token: options.job.leaseToken,
          verified_recipient_email_hmac: options.recipientEmailHmac,
          provider_message_id: options.providerMessageId,
          email_log_id: null,
        },
      )
      if (error) repositoryError("complete", error)
      if (
        typeof data !== "string" ||
        data.length > 64 ||
        !Number.isFinite(Date.parse(data))
      ) {
        repositoryError("complete_shape")
      }
    },

    async failDelivery(options) {
      const { data, error } = await client.rpc("fail_email_outbox_delivery", {
        outbox_id: options.job.outboxId,
        lease_token: options.job.leaseToken,
        error_summary: options.errorSummary,
        retry_after_seconds: options.retryAfterSeconds,
      })
      if (error) repositoryError("fail", error)
      if (typeof data !== "boolean") repositoryError("fail_shape")
      return { retryable: data }
    },
  }
}
