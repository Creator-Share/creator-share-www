import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { createSponsorshipCryptoFromEnvironment } from "@/lib/sponsorships/crypto"
import {
  LegacyStripeWebhookError,
  type LegacyStripeWebhookDependencies,
  type VerifiedLegacyStripeEventInput,
  type VerifiedLegacyStripeEventResult,
} from "@/lib/sponsorships/gateways/legacyStripeWebhook"

interface DatabaseError {
  code?: string
}

function infrastructure(): LegacyStripeWebhookError {
  return new LegacyStripeWebhookError("infrastructure", { retryable: true })
}

function databaseFailure(error: DatabaseError | null): never {
  if (error?.code === "23505") {
    throw new LegacyStripeWebhookError("evidence-conflict", {
      httpStatus: 409,
    })
  }
  if (["22023", "22P02", "23503", "23514"].includes(error?.code || "")) {
    throw new LegacyStripeWebhookError("invalid-evidence")
  }
  throw infrastructure()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function exactlyOneRow(data: unknown): Record<string, unknown> {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) {
    throw infrastructure()
  }
  return data[0]
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== "string" || value.length < 1) throw infrastructure()
  return value
}

async function ingestVerifiedLegacyEvent(
  client: SupabaseClient,
  input: VerifiedLegacyStripeEventInput,
): Promise<VerifiedLegacyStripeEventResult> {
  const { data, error } = await client.rpc(
    "ingest_verified_legacy_stripe_gateway_event",
    {
      target_provider_account_scope: input.providerAccountScope,
      target_provider_event_id: input.providerEventId,
      target_event_type: input.eventType,
      target_provider_object_type: input.providerObjectType,
      target_provider_object_id: input.providerObjectId,
      target_redacted_payload: input.redactedPayload,
      target_payload_ciphertext: input.payloadCiphertext,
      target_payload_sha256: input.payloadSha256,
      target_signature_verified_at: input.signatureVerifiedAt,
      target_occurred_at: input.occurredAt,
      context_request_id: input.requestContext.requestId,
      context_trace_id: input.requestContext.traceId,
      context_client_ip: input.requestContext.clientIp,
      context_user_agent: input.requestContext.userAgent,
    },
  )
  if (error) databaseFailure(error)

  const row = exactlyOneRow(data)
  const isDuplicate = row.is_duplicate
  if (typeof isDuplicate !== "boolean") throw infrastructure()
  return {
    gatewayEventId: requiredString(row, "gateway_event_id"),
    processingStatus: requiredString(row, "processing_status"),
    isDuplicate,
  }
}

export function createLegacyStripeWebhookDependencies(
  client: SupabaseClient,
): LegacyStripeWebhookDependencies {
  return {
    crypto: createSponsorshipCryptoFromEnvironment(),
    ingestVerifiedLegacyEvent: (input) =>
      ingestVerifiedLegacyEvent(client, input),
    now: () => new Date(),
  }
}
