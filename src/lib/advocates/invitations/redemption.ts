import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { AdvocateInvitationAuditContext } from "@/lib/advocates/invitations/administration"
import type { AdvocateInvitationMaterial } from "@/lib/advocates/invitations/material"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export interface AdvocateInvitationRedemption {
  advocateId: string
  membershipId: string
  membershipVersion: number
}

export class AdvocateInvitationRedemptionError extends Error {
  readonly stage: "authentication" | "redemption" | "shape"
  readonly postgresCode: string | undefined

  constructor(
    stage: "authentication" | "redemption" | "shape",
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
  material: AdvocateInvitationMaterial
  context: AdvocateInvitationAuditContext
}): Promise<{ authUserId: string; redemption: AdvocateInvitationRedemption }> {
  const verification = await options.client.auth.verifyOtp({
    token_hash: options.material.authTokenHash,
    type: options.material.authType,
  })

  let authUserId = verification.data.user?.id ?? null
  if (verification.error || authUserId === null) {
    const current = await options.client.auth.getUser()
    authUserId = current.error ? null : (current.data.user?.id ?? null)
    if (authUserId === null) {
      throw new AdvocateInvitationRedemptionError(
        "authentication",
        verification.error,
      )
    }
  }

  const { data, error } = await options.client.rpc(
    "redeem_advocate_invitation",
    {
      plaintext_capability: options.material.capability,
      change_reason: "Accept advocate portal invitation",
      request_id: options.context.requestId,
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
