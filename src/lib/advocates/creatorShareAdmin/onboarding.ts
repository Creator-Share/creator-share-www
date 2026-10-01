import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  CreatorShareAdvocateOnboardingRequest,
  CreatorShareAdvocateOnboardingStatus,
} from "@/lib/advocates/creatorShareAdmin/onboardingContracts"
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
const ONBOARDING_RESULT_KEYS = Object.freeze([
  "advocate_id",
  "advocate_version",
  "created",
  "onboarding_status",
  "operation_id",
] as const)

type SupabaseErrorLike = Readonly<{ code?: string }> | null

export interface CreatorShareAdvocateOnboardingAuditContext {
  traceId: string
  sessionId: string | null
  clientIp: string | null
  userAgent: string | null
}

export interface CreatorShareAdvocateOnboardingResult {
  operationId: string
  advocateId: string
  advocateVersion: number
  onboardingStatus: CreatorShareAdvocateOnboardingStatus
  created: boolean
}

export interface CreatorShareAdvocateOnboardingRepository {
  onboard(input: {
    onboarding: CreatorShareAdvocateOnboardingRequest
    context: CreatorShareAdvocateOnboardingAuditContext
  }): Promise<CreatorShareAdvocateOnboardingResult>
}

export class CreatorShareAdvocateOnboardingRepositoryError extends Error {
  readonly stage: "input" | "material" | "onboard" | "shape"
  readonly postgresCode: string | undefined

  constructor(
    stage: CreatorShareAdvocateOnboardingRepositoryError["stage"],
    cause: SupabaseErrorLike = null,
  ) {
    super("creator_share_advocate_onboarding_unavailable", { cause })
    this.name = "CreatorShareAdvocateOnboardingRepositoryError"
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

export function parseCreatorShareAdvocateOnboardingResult(
  value: unknown,
  expectedOperationId: string,
): CreatorShareAdvocateOnboardingResult | null {
  const row = oneRow(value)
  if (row === null || !hasExactKeys(row, ONBOARDING_RESULT_KEYS)) return null

  const version = parseVersion(row.advocate_version)
  if (
    row.operation_id !== expectedOperationId ||
    typeof row.advocate_id !== "string" ||
    !UUID_PATTERN.test(row.advocate_id) ||
    version === null ||
    row.onboarding_status !== "initial_owner_invitation_queued" ||
    typeof row.created !== "boolean"
  ) {
    return null
  }

  return Object.freeze({
    operationId: expectedOperationId,
    advocateId: row.advocate_id,
    advocateVersion: version,
    onboardingStatus: "initial_owner_invitation_queued",
    created: row.created,
  })
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
      throw new CreatorShareAdvocateOnboardingRepositoryError("input", {
        code: "22023",
      })
    }
    throw error
  }

  try {
    const delivery = implementation(normalizedEmail)
    if (delivery.normalizedEmail !== normalizedEmail) {
      throw new CreatorShareAdvocateOnboardingRepositoryError("material")
    }
    return delivery
  } catch (error) {
    if (error instanceof CreatorShareAdvocateOnboardingRepositoryError) {
      throw error
    }
    if (error instanceof AdvocateInvitationRepositoryError) {
      throw new CreatorShareAdvocateOnboardingRepositoryError("material")
    }
    throw new CreatorShareAdvocateOnboardingRepositoryError("material")
  }
}

export function createCreatorShareAdvocateOnboardingRepository(
  authenticatedClient: SupabaseClient,
  dependencies: Readonly<{
    prepareInvitationDelivery?: (
      email: string,
    ) => PreparedAdvocateInvitationDelivery
  }> = {},
): CreatorShareAdvocateOnboardingRepository {
  const prepare =
    dependencies.prepareInvitationDelivery ?? prepareAdvocateInvitationDelivery

  return {
    async onboard({ onboarding, context }) {
      const delivery = prepareDelivery(onboarding.ownerEmail, prepare)
      const { data, error } = await authenticatedClient.rpc(
        "onboard_creator_share_advocate",
        {
          onboarding_operation_id: onboarding.operationId,
          portal_slug: onboarding.slug,
          portal_display_name: onboarding.displayName,
          portal_advocate_type: onboarding.advocateType,
          owner_email: delivery.normalizedEmail,
          capability_digest: delivery.capabilityDigest,
          recipient_email_ciphertext: delivery.recipientEmailCiphertext,
          recipient_email_hmac: delivery.recipientEmailHmac,
          secret_payload_ciphertext: delivery.secretPayloadCiphertext,
          email_normalization_version: delivery.emailNormalizationVersion,
          email_hmac_key_version: delivery.emailHmacKeyVersion,
          email_encryption_key_version: delivery.emailEncryptionKeyVersion,
          change_reason: onboarding.reason,
          request_id: onboarding.operationId,
          trace_id: context.traceId,
          session_id: context.sessionId,
          client_ip: context.clientIp,
          user_agent: context.userAgent,
        },
      )
      if (error) {
        throw new CreatorShareAdvocateOnboardingRepositoryError(
          "onboard",
          error,
        )
      }
      const result = parseCreatorShareAdvocateOnboardingResult(
        data,
        onboarding.operationId,
      )
      if (result === null) {
        throw new CreatorShareAdvocateOnboardingRepositoryError("shape")
      }
      return result
    },
  }
}

export function classifyCreatorShareAdvocateOnboardingFailure(
  postgresCode: string | undefined,
): Readonly<{ status: number; code: string }> {
  switch (postgresCode) {
    case "22023":
      return { status: 400, code: "invalid_request" }
    case "28000":
      return { status: 401, code: "unauthorized" }
    case "42501":
      return { status: 403, code: "forbidden" }
    case "23505":
    case "23514":
    case "40001":
    case "55000":
    case "55P03":
      return { status: 409, code: "onboarding_conflict" }
    default:
      return { status: 503, code: "onboarding_unavailable" }
  }
}
