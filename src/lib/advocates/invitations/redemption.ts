import "server-only"

import {
  isAuthSessionMissingError,
  type SupabaseClient,
} from "@supabase/supabase-js"

import type { AdvocateInvitationAuditContext } from "@/lib/advocates/invitations/administration"
import type {
  AdvocateInvitationAuthenticationRequest,
  AdvocateInvitationRedemptionRequest,
  AdvocateInvitationRecoveryRequest,
} from "@/lib/advocates/invitations/material"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ADVOCATE_INVITATION_AUTHENTICATION_MAXIMUM_AGE_SECONDS = 15 * 60
const ADVOCATE_INVITATION_AUTHENTICATION_FUTURE_SKEW_SECONDS = 60

export interface AdvocateInvitationRedemption {
  advocateId: string
  membershipId: string
  membershipVersion: number
}

export class AdvocateInvitationRedemptionError extends Error {
  readonly stage: "authentication" | "recovery" | "redemption" | "shape"
  readonly postgresCode: string | undefined

  constructor(
    stage: "authentication" | "recovery" | "redemption" | "shape",
    cause: Readonly<{ code?: string }> | null = null,
  ) {
    super("advocate_invitation_redemption_failed", { cause })
    this.name = "AdvocateInvitationRedemptionError"
    this.stage = stage
    this.postgresCode = cause?.code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function authenticationUnavailable(): Error {
  return new Error("advocate_invitation_authentication_unavailable")
}

function isDeterministicInvalidProof(
  error: Readonly<{ code?: string }> | null,
): boolean {
  return error?.code === "otp_expired"
}

function hasFreshOtpClaims(
  value: unknown,
  expectedUserId: string,
  nowEpochSeconds = Math.floor(Date.now() / 1_000),
): boolean {
  if (!isRecord(value)) return false
  const subject = value.sub
  const sessionId = value.session_id
  const assuranceLevel = value.aal
  const issuedAt = value.iat
  const methods = value.amr
  if (
    subject !== expectedUserId ||
    typeof sessionId !== "string" ||
    !UUID_PATTERN.test(sessionId) ||
    (assuranceLevel !== "aal1" && assuranceLevel !== "aal2") ||
    typeof issuedAt !== "number" ||
    !Number.isSafeInteger(issuedAt) ||
    issuedAt >
      nowEpochSeconds +
        ADVOCATE_INVITATION_AUTHENTICATION_FUTURE_SKEW_SECONDS ||
    !Array.isArray(methods)
  ) {
    return false
  }

  return methods.some((method) => {
    if (!isRecord(method) || method.method !== "otp") return false
    const timestamp = method.timestamp
    return (
      typeof timestamp === "number" &&
      Number.isSafeInteger(timestamp) &&
      timestamp <=
        nowEpochSeconds +
          ADVOCATE_INVITATION_AUTHENTICATION_FUTURE_SKEW_SECONDS &&
      timestamp >=
        nowEpochSeconds - ADVOCATE_INVITATION_AUTHENTICATION_MAXIMUM_AGE_SECONDS
    )
  })
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

export function parseAdvocateInvitationRedemption(
  value: unknown,
): AdvocateInvitationRedemption | null {
  const row = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : null
    : value
  if (!isRecord(row)) return null

  const keys = Object.keys(row).sort()
  const advocateId = row.advocate_id
  const membershipId = row.membership_id
  const membershipVersion = parseVersion(row.membership_version)
  if (
    keys.length !== 3 ||
    keys[0] !== "advocate_id" ||
    keys[1] !== "membership_id" ||
    keys[2] !== "membership_version" ||
    typeof advocateId !== "string" ||
    !UUID_PATTERN.test(advocateId) ||
    typeof membershipId !== "string" ||
    !UUID_PATTERN.test(membershipId) ||
    membershipVersion === null
  ) {
    return null
  }
  return Object.freeze({ advocateId, membershipId, membershipVersion })
}

export async function redeemAdvocateInvitation(options: {
  client: SupabaseClient
  request: AdvocateInvitationRedemptionRequest
  context: AdvocateInvitationAuditContext
}): Promise<{ authUserId: string; redemption: AdvocateInvitationRedemption }> {
  const current = await options.client.auth.getUser()
  const authUserId = current.error ? null : (current.data.user?.id ?? null)
  if (authUserId === null) {
    throw new AdvocateInvitationRedemptionError("authentication", current.error)
  }

  const { data, error } = await options.client.rpc(
    "redeem_advocate_invitation",
    {
      redemption_operation_id: options.request.operationId,
      plaintext_capability: options.request.capability,
      change_reason: "Accept advocate portal invitation",
      request_id: options.request.operationId,
      trace_id: options.context.traceId,
      session_id: null,
      client_ip: null,
      user_agent: null,
    },
  )
  if (error) throw new AdvocateInvitationRedemptionError("redemption", error)

  const redemption = parseAdvocateInvitationRedemption(data)
  if (redemption === null) {
    throw new AdvocateInvitationRedemptionError("shape")
  }
  return Object.freeze({ authUserId, redemption })
}

export async function authenticateAdvocateInvitation(options: {
  client: SupabaseClient
  request: AdvocateInvitationAuthenticationRequest
}): Promise<{ authUserId: string }> {
  const verification = await options.client.auth.verifyOtp({
    token_hash: options.request.authTokenHash,
    type: options.request.authType,
  })
  const verifiedSession = verification.data.session
  const accessToken = verifiedSession?.access_token ?? null
  const verifiedUserId = verification.data.user?.id ?? null
  const sessionUserId = verifiedSession?.user?.id ?? null

  if (
    !verification.error &&
    typeof accessToken === "string" &&
    accessToken.length > 0 &&
    typeof verifiedUserId === "string" &&
    UUID_PATTERN.test(verifiedUserId) &&
    sessionUserId === verifiedUserId
  ) {
    return Object.freeze({ authUserId: verifiedUserId })
  }
  if (!verification.error) {
    throw authenticationUnavailable()
  }

  const current = await options.client.auth.getUser()
  const currentSessionMissing = isAuthSessionMissingError(current.error)
  if (current.error && !currentSessionMissing) {
    throw authenticationUnavailable()
  }

  const authUserId = currentSessionMissing
    ? null
    : (current.data.user?.id ?? null)
  if (authUserId !== null) {
    const claims = await options.client.auth.getClaims()
    if (claims.error) throw authenticationUnavailable()
    if (hasFreshOtpClaims(claims.data?.claims, authUserId)) {
      return Object.freeze({ authUserId })
    }
  }

  if (isDeterministicInvalidProof(verification.error)) {
    throw new AdvocateInvitationRedemptionError(
      "authentication",
      verification.error,
    )
  }
  throw authenticationUnavailable()
}

export async function recoverAdvocateInvitationRedemption(options: {
  client: SupabaseClient
  request: AdvocateInvitationRecoveryRequest
}): Promise<{ authUserId: string; redemption: AdvocateInvitationRedemption }> {
  const current = await options.client.auth.getUser()
  const authUserId = current.error ? null : (current.data.user?.id ?? null)
  if (authUserId === null) {
    throw new AdvocateInvitationRedemptionError("authentication", current.error)
  }

  const { data, error } = await options.client.rpc(
    "recover_advocate_invitation_redemption",
    { redemption_operation_id: options.request.operationId },
  )
  if (error) throw new AdvocateInvitationRedemptionError("recovery", error)

  const redemption = parseAdvocateInvitationRedemption(data)
  if (redemption === null) {
    throw new AdvocateInvitationRedemptionError("shape")
  }
  return Object.freeze({ authUserId, redemption })
}
