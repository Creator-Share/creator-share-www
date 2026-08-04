import { performance } from "node:perf_hooks"

import { NextResponse } from "next/server"

import { advocateInvitationRequestContext } from "@/lib/advocates/invitations/requestContext"
import { isTrustedCreatorShareAdvocateControlRequest } from "@/lib/advocates/creatorShareAdmin/routeSecurity"
import {
  parseCreatorShareAdminInvitationRequest,
  readBoundedCreatorShareAdminInvitationBody,
} from "@/lib/auth/creatorShareAdminInvitationContracts"
import {
  EMAIL_PROOF_AMBIGUOUS_RETRY_AFTER_SECONDS,
  EMAIL_PROOF_ISSUER_WORST_CASE_DURATION_MILLISECONDS,
  issueCreatorShareAdminInvitationEmailProof,
} from "@/lib/auth/supabaseEmailProofIssuer"
import { getSponsorClaimCanonicalOrigin } from "@/lib/sponsorships/accountClaim"
import {
  replaceCreatorShareRoles,
  roleChangeReason,
} from "@/utils/admin/creatorShareRoles"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { createClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const AUTHENTICATED_REQUEST_TIMEOUT_MILLISECONDS = 8_000
const INVOCATION_BUDGET_MILLISECONDS = 110_000
const FINAL_RESPONSE_MARGIN_MILLISECONDS = 5_000
const FALLBACK_ROLE_CHANGE_REASON =
  "Administrator assigned initial Creator Share roles to an invited user"

function response(
  body: Record<string, unknown>,
  status: number,
  retryAfterSeconds?: number,
): NextResponse {
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store, max-age=0",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  }
  if (retryAfterSeconds !== undefined) {
    headers["Retry-After"] = String(retryAfterSeconds)
  }
  return NextResponse.json(body, { status, headers })
}

function unavailable(requestId: string): NextResponse {
  return response(
    {
      ok: false,
      requestId,
      code: "invitation_unavailable",
      error: "Invitation temporarily unavailable",
    },
    503,
    EMAIL_PROOF_AMBIGUOUS_RETRY_AFTER_SECONDS,
  )
}

function accepted(requestId: string): NextResponse {
  return response(
    {
      ok: true,
      requestId,
      code: "invitation_accepted",
    },
    202,
  )
}

function reportFailure(code: string, requestId: string): void {
  console.error(code, { requestId })
}

async function requestedRolesExist(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roleIds: readonly string[],
): Promise<"valid" | "invalid" | "unavailable"> {
  try {
    const { data, error } = await supabase
      .from("roles")
      .select("id")
      .in("id", [...roleIds])
    if (error || !Array.isArray(data)) return "unavailable"
    const returnedIds = data.map((row) =>
      row && typeof row === "object" && !Array.isArray(row)
        ? (row as { id?: unknown }).id
        : null,
    )
    if (
      returnedIds.some((id) => typeof id !== "string") ||
      new Set(returnedIds).size !== returnedIds.length
    ) {
      return "unavailable"
    }
    const requested = new Set(roleIds)
    return returnedIds.length === requested.size &&
      returnedIds.every((id) => typeof id === "string" && requested.has(id))
      ? "valid"
      : "invalid"
  } catch {
    return "unavailable"
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const invocationDeadlineAt =
    performance.now() + INVOCATION_BUDGET_MILLISECONDS

  if (!isTrustedCreatorShareAdvocateControlRequest(request)) {
    return response(
      { ok: false, code: "invalid_request", error: "Invalid request" },
      400,
    )
  }

  let context: ReturnType<typeof advocateInvitationRequestContext>
  try {
    context = advocateInvitationRequestContext(request)
  } catch {
    console.error("CREATOR_SHARE_ADMIN_INVITATION_CONTEXT_UNAVAILABLE")
    return response(
      {
        ok: false,
        code: "invitation_unavailable",
        error: "Invitation temporarily unavailable",
      },
      503,
      EMAIL_PROOF_AMBIGUOUS_RETRY_AFTER_SECONDS,
    )
  }

  let supabase: Awaited<ReturnType<typeof createClient>>
  let invitingUserId: string
  try {
    supabase = await createClient({
      requestTimeoutMilliseconds: AUTHENTICATED_REQUEST_TIMEOUT_MILLISECONDS,
    })
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) {
      const status = auth.response.status === 401 ? 401 : 403
      return response(
        {
          ok: false,
          requestId: context.requestId,
          code: status === 401 ? "unauthorized" : "forbidden",
          error: status === 401 ? "Unauthorized" : "Forbidden",
        },
        status,
      )
    }
    invitingUserId = auth.user.id
  } catch {
    reportFailure(
      "CREATOR_SHARE_ADMIN_INVITATION_AUTH_UNAVAILABLE",
      context.requestId,
    )
    return unavailable(context.requestId)
  }

  const rawBody = await readBoundedCreatorShareAdminInvitationBody(request)
  const invitation =
    rawBody === null ? null : parseCreatorShareAdminInvitationRequest(rawBody)
  if (invitation === null) {
    return response(
      {
        ok: false,
        requestId: context.requestId,
        code: "invalid_request",
        error: "Invalid request",
      },
      400,
    )
  }

  const roleCatalogResult = await requestedRolesExist(
    supabase,
    invitation.roleIds,
  )
  if (roleCatalogResult === "invalid") {
    return response(
      {
        ok: false,
        requestId: context.requestId,
        code: "invalid_request",
        error: "Invalid request",
      },
      400,
    )
  }
  if (roleCatalogResult === "unavailable") {
    reportFailure(
      "CREATOR_SHARE_ADMIN_INVITATION_ROLE_CATALOG_UNAVAILABLE",
      context.requestId,
    )
    return unavailable(context.requestId)
  }

  let redirectTo: string
  try {
    redirectTo = `${getSponsorClaimCanonicalOrigin()}/set-password`
  } catch {
    reportFailure(
      "CREATOR_SHARE_ADMIN_INVITATION_CONFIGURATION_UNAVAILABLE",
      context.requestId,
    )
    return unavailable(context.requestId)
  }

  let issuance: Awaited<
    ReturnType<typeof issueCreatorShareAdminInvitationEmailProof>
  >
  if (
    invocationDeadlineAt <=
    performance.now() +
      EMAIL_PROOF_ISSUER_WORST_CASE_DURATION_MILLISECONDS +
      AUTHENTICATED_REQUEST_TIMEOUT_MILLISECONDS +
      FINAL_RESPONSE_MARGIN_MILLISECONDS
  ) {
    reportFailure(
      "CREATOR_SHARE_ADMIN_INVITATION_DEADLINE_INSUFFICIENT",
      context.requestId,
    )
    return unavailable(context.requestId)
  }
  try {
    issuance = await issueCreatorShareAdminInvitationEmailProof({
      recipientEmail: invitation.email,
      redirectTo,
      invitedByUserId: invitingUserId,
      context: {
        requestId: context.requestId,
        traceId: context.traceId,
      },
    })
  } catch {
    reportFailure(
      "CREATOR_SHARE_ADMIN_INVITATION_ISSUANCE_REQUIRES_REVIEW",
      context.requestId,
    )
    return accepted(context.requestId)
  }

  if (issuance.status === "ambiguous") {
    reportFailure(
      "CREATOR_SHARE_ADMIN_INVITATION_ISSUANCE_REQUIRES_REVIEW",
      context.requestId,
    )
    return accepted(context.requestId)
  }
  if (issuance.status !== "issued") {
    reportFailure(
      "CREATOR_SHARE_ADMIN_INVITATION_NOT_ISSUED",
      context.requestId,
    )
    return unavailable(context.requestId)
  }
  if (!UUID_PATTERN.test(issuance.userId)) {
    reportFailure(
      "CREATOR_SHARE_ADMIN_INVITATION_ISSUANCE_REQUIRES_REVIEW",
      context.requestId,
    )
    return accepted(context.requestId)
  }

  try {
    await replaceCreatorShareRoles(
      supabase,
      context.requestId,
      issuance.userId,
      [...invitation.roleIds],
      roleChangeReason(invitation.reason, FALLBACK_ROLE_CHANGE_REASON),
    )
  } catch {
    reportFailure(
      "CREATOR_SHARE_ADMIN_INVITATION_ROLE_ASSIGNMENT_FAILED",
      context.requestId,
    )
    return accepted(context.requestId)
  }

  return accepted(context.requestId)
}
