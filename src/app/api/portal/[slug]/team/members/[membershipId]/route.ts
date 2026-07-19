import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import {
  createAdvocatePortalAccessRepository,
  findAdvocatePortalAccessBySlug,
} from "@/lib/advocates/admin/access"
import {
  createAdvocateTeamRepository,
  AdvocateTeamRepositoryError,
} from "@/lib/advocates/admin/team"
import {
  isAdvocateMembershipId,
  parseAdvocateTeamMemberMutation,
} from "@/lib/advocates/admin/teamContracts"
import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedPrimaryRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import { createClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAXIMUM_TEAM_MUTATION_BODY_BYTES = 8_192

function response(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

function boundedTraceId(request: Request): string | null {
  for (const name of ["traceparent", "x-trace-id", "x-vercel-id"]) {
    const value = request.headers.get(name)?.trim()
    if (value && value.length <= 255 && !/[\u0000-\u001f\u007f]/.test(value)) {
      return value
    }
  }
  return null
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const contentLength = request.headers.get("content-length")
  if (
    contentLength !== null &&
    (!/^\d{1,10}$/.test(contentLength) ||
      Number(contentLength) > MAXIMUM_TEAM_MUTATION_BODY_BYTES)
  ) {
    return null
  }
  if (request.body === null) return null

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAXIMUM_TEAM_MUTATION_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    )
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

function classifyMutationFailure(error: unknown): {
  status: number
  code: string
} {
  const postgresCode =
    error instanceof AdvocateTeamRepositoryError
      ? error.postgresCode
      : undefined
  switch (postgresCode) {
    case "40001":
      return { status: 409, code: "version_conflict" }
    case "42501":
    case "28000":
      return { status: 403, code: "permission_changed" }
    case "22023":
      return { status: 400, code: "invalid_request" }
    case "55000":
    case "23514":
      return { status: 409, code: "lifecycle_conflict" }
    default:
      return { status: 500, code: "team_update_failed" }
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; membershipId: string }> },
): Promise<NextResponse> {
  const requestId = randomUUID()
  const expectedOrigin = resolveTrustedPrimaryRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    expectedOrigin === null ||
    !isTrustedCheckoutJsonRequest(request.headers, expectedOrigin)
  ) {
    return response({ ok: false, code: "invalid_request", requestId }, 400)
  }

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) {
    return response({ ok: false, code: "unauthorized", requestId }, 401)
  }

  const { slug, membershipId } = await params
  if (!isAdvocateMembershipId(membershipId)) {
    return response({ ok: false, code: "member_not_found", requestId }, 404)
  }

  let portal
  try {
    const portals =
      await createAdvocatePortalAccessRepository(client).listForCurrentUser()
    portal = findAdvocatePortalAccessBySlug(portals, slug)
  } catch {
    console.error("ADVOCATE_PORTAL_TEAM_FAILED", {
      requestId,
      code: "access_unavailable",
    })
    return response({ ok: false, code: "team_update_failed", requestId }, 500)
  }
  if (portal === null) {
    return response({ ok: false, code: "portal_not_found", requestId }, 404)
  }
  if (!portal.permissions.includes("portal.members.manage")) {
    return response({ ok: false, code: "forbidden", requestId }, 403)
  }

  const rawBody = await readBoundedBody(request)
  const mutation =
    rawBody === null ? null : parseAdvocateTeamMemberMutation(rawBody)
  if (mutation === null) {
    return response({ ok: false, code: "invalid_request", requestId }, 400)
  }

  const repository = createAdvocateTeamRepository(client)
  const context = {
    requestId,
    traceId: boundedTraceId(request),
    sessionId: null,
  }
  try {
    const membershipVersion =
      mutation.action === "replace_roles"
        ? await repository.replaceRoles({
            advocateId: portal.advocateId,
            membershipId,
            expectedVersion: mutation.expectedVersion,
            roleKeys: mutation.roleKeys,
            reason: mutation.reason,
            context,
          })
        : await repository.changeStatus({
            advocateId: portal.advocateId,
            membershipId,
            expectedVersion: mutation.expectedVersion,
            status: mutation.status,
            reason: mutation.reason,
            context,
          })

    return response({ ok: true, requestId, membershipVersion }, 200)
  } catch (error) {
    const failure = classifyMutationFailure(error)
    if (failure.status === 500) {
      console.error("ADVOCATE_PORTAL_TEAM_FAILED", {
        requestId,
        code: failure.code,
      })
    }
    return response(
      { ok: false, code: failure.code, requestId },
      failure.status,
    )
  }
}
