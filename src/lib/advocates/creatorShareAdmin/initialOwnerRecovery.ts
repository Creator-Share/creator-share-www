import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  AdvocateInvitationRepositoryError,
  prepareAdvocateInvitationDelivery,
  type PreparedAdvocateInvitationDelivery,
} from "@/lib/advocates/invitations/administration"
import {
  normalizeSponsorEmailV1,
  SponsorshipCryptoError,
} from "@/lib/sponsorships/crypto"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const RESULT_KEYS = Object.freeze([
  "advocate_id",
  "advocate_version",
  "created",
  "operation_id",
  "onboarding_status",
] as const)

type SupabaseErrorLike = Readonly<{ code?: string }> | null

export interface CreatorShareInitialOwnerReissueResult {
  operationId: string
  advocateId: string
  advocateVersion: number
  reissueStatus: "initial_owner_invitation_requeued"
  created: boolean
}

export interface CreatorShareInitialOwnerReissueAuditContext {
  traceId: string
  sessionId: string | null
  clientIp: string | null
  userAgent: string | null
}

export class CreatorShareInitialOwnerReissueRepositoryError extends Error {
  readonly stage: "material" | "reissue" | "shape"
  readonly postgresCode: string | undefined

  constructor(
    stage: CreatorShareInitialOwnerReissueRepositoryError["stage"],
    cause: SupabaseErrorLike = null,
  ) {
    super("creator_share_initial_owner_reissue_unavailable", { cause })
    this.name = "CreatorShareInitialOwnerReissueRepositoryError"
    this.stage = stage
    this.postgresCode = cause?.code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  )
}

function oneRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : null
    : value
  return isRecord(row) ? row : null
}

function parseVersion(value: unknown): number | null {
  const parsed =
    typeof value === "string" && /^[1-9]\d{0,15}$/.test(value)
      ? Number(value)
      : value
  return typeof parsed === "number" &&
    Number.isSafeInteger(parsed) &&
    parsed >= 1
    ? parsed
    : null
}

function prepareDelivery(
  ownerEmail: string,
  implementation: (email: string) => PreparedAdvocateInvitationDelivery,
): PreparedAdvocateInvitationDelivery {
  let normalizedEmail: string
  try {
    normalizedEmail = normalizeSponsorEmailV1(ownerEmail)
  } catch (error) {
    if (error instanceof SponsorshipCryptoError) {
      throw new CreatorShareInitialOwnerReissueRepositoryError("material", {
        code: "22023",
      })
    }
    throw error
  }

  try {
    const delivery = implementation(normalizedEmail)
    if (delivery.normalizedEmail !== normalizedEmail) {
      throw new CreatorShareInitialOwnerReissueRepositoryError("material")
    }
    return delivery
  } catch (error) {
    if (error instanceof CreatorShareInitialOwnerReissueRepositoryError) {
      throw error
    }
    if (error instanceof AdvocateInvitationRepositoryError) {
      throw new CreatorShareInitialOwnerReissueRepositoryError("material")
    }
    throw new CreatorShareInitialOwnerReissueRepositoryError("material")
  }
}

export function parseCreatorShareInitialOwnerReissueResult(
  value: unknown,
  expected: Readonly<{
    operationId: string
    advocateId: string
    expectedVersion: number
  }>,
): CreatorShareInitialOwnerReissueResult | null {
  const row = oneRow(value)
  if (row === null || !hasExactKeys(row, RESULT_KEYS)) return null
  const version = parseVersion(row.advocate_version)
  if (
    row.operation_id !== expected.operationId ||
    row.advocate_id !== expected.advocateId ||
    !UUID_PATTERN.test(expected.advocateId) ||
    version !== expected.expectedVersion + 1 ||
    row.onboarding_status !== "initial_owner_invitation_requeued" ||
    typeof row.created !== "boolean"
  ) {
    return null
  }
  return Object.freeze({
    operationId: expected.operationId,
    advocateId: expected.advocateId,
    advocateVersion: version,
    reissueStatus: "initial_owner_invitation_requeued" as const,
    created: row.created,
  })
}

export function createCreatorShareInitialOwnerReissueRepository(
  client: SupabaseClient,
  dependencies: Readonly<{
    prepareInvitationDelivery?: (
      email: string,
    ) => PreparedAdvocateInvitationDelivery
  }> = {},
) {
  const prepare =
    dependencies.prepareInvitationDelivery ?? prepareAdvocateInvitationDelivery
  return {
    async reissue(input: {
      advocateId: string
      expectedVersion: number
      ownerEmail: string
      reason: string
      operationId: string
      context: CreatorShareInitialOwnerReissueAuditContext
    }): Promise<CreatorShareInitialOwnerReissueResult> {
      const delivery = prepareDelivery(input.ownerEmail, prepare)
      const { data, error } = await client.rpc(
        "reissue_advocate_initial_owner_invitation",
        {
          reissue_operation_id: input.operationId,
          target_advocate_id: input.advocateId,
          expected_advocate_version: input.expectedVersion,
          owner_email: delivery.normalizedEmail,
          capability_digest: delivery.capabilityDigest,
          recipient_email_ciphertext: delivery.recipientEmailCiphertext,
          recipient_email_hmac: delivery.recipientEmailHmac,
          secret_payload_ciphertext: delivery.secretPayloadCiphertext,
          email_normalization_version: delivery.emailNormalizationVersion,
          email_hmac_key_version: delivery.emailHmacKeyVersion,
          email_encryption_key_version: delivery.emailEncryptionKeyVersion,
          change_reason: input.reason,
          request_id: input.operationId,
          trace_id: input.context.traceId,
          session_id: input.context.sessionId,
          client_ip: input.context.clientIp,
          user_agent: input.context.userAgent,
        },
      )
      if (error) {
        throw new CreatorShareInitialOwnerReissueRepositoryError(
          "reissue",
          error,
        )
      }
      const result = parseCreatorShareInitialOwnerReissueResult(data, input)
      if (result === null) {
        throw new CreatorShareInitialOwnerReissueRepositoryError("shape")
      }
      return result
    },
  }
}

export function classifyCreatorShareInitialOwnerReissueFailure(
  postgresCode: string | undefined,
): Readonly<{ status: number; code: string }> {
  switch (postgresCode) {
    case "22023":
      return { status: 400, code: "invalid_request" }
    case "28000":
      return { status: 401, code: "unauthorized" }
    case "42501":
      return { status: 403, code: "forbidden" }
    case "23503":
      return { status: 404, code: "portal_not_found" }
    case "23505":
    case "23514":
    case "40001":
    case "55000":
    case "55P03":
      return { status: 409, code: "initial_owner_reissue_conflict" }
    default:
      return { status: 503, code: "initial_owner_reissue_unavailable" }
  }
}
