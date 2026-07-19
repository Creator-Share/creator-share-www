import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import {
  createAdvocatePortalAccessRepository,
  findAdvocatePortalAccessBySlug,
} from "@/lib/advocates/admin/access"
import {
  AdvocateBrandingDatabaseError,
  classifyAdvocateBrandingUpdateFailure,
  updateAdvocateBranding,
} from "@/lib/advocates/admin/branding"
import {
  AdvocateLogoProcessingError,
  isAdvocateLogoMultipartContentType,
  parseAdvocateLogoUploadInput,
  processAdvocateLogo,
  readBoundedAdvocateLogoMultipartBody,
} from "@/lib/advocates/admin/logo"
import {
  AdvocateLogoReservationDatabaseError,
  classifyAdvocateLogoReservationFailure,
  getAdvocateLogoUploadReservationResult,
  reserveAdvocateLogoUpload,
  settleAdvocateLogoUploadReservation,
  type AdvocateLogoReservationTerminalStatus,
  type AdvocateLogoUploadReservation,
} from "@/lib/advocates/admin/logoReservation"
import { resolveTrustedPrimaryRequestOrigin } from "@/lib/sponsorships/checkout/requestSecurity"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const LOGO_BUCKET = "advocate-assets"

function response(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

function isTrustedMultipartRequest(
  request: Request,
  expectedOrigin: string,
): boolean {
  const fetchSite = request.headers.get("sec-fetch-site")
  return (
    request.headers.get("origin") === expectedOrigin &&
    (fetchSite === null || fetchSite === "same-origin") &&
    isAdvocateLogoMultipartContentType(request.headers.get("content-type"))
  )
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

async function removeUploadedLogo(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  path: string,
  requestId: string,
  reservationId: string,
): Promise<boolean> {
  try {
    const { error } = await serviceClient.storage
      .from(LOGO_BUCKET)
      .remove([path])
    if (error) {
      console.error("ADVOCATE_PORTAL_LOGO_CLEANUP_FAILED", {
        requestId,
        reservationId,
        code: "storage_remove_failed",
      })
      return false
    }
    return true
  } catch {
    console.error("ADVOCATE_PORTAL_LOGO_CLEANUP_FAILED", {
      requestId,
      reservationId,
      code: "storage_remove_failed",
    })
    return false
  }
}

async function settleReservationFailure(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  input: {
    reservation: AdvocateLogoUploadReservation
    actorUserId: string
    requestId: string
    status: AdvocateLogoReservationTerminalStatus
    failureCode: string
  },
): Promise<void> {
  try {
    await settleAdvocateLogoUploadReservation(serviceClient, {
      reservationId: input.reservation.reservationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      status: input.status,
      failureCode: input.failureCode,
    })
  } catch {
    console.error("ADVOCATE_PORTAL_LOGO_RESERVATION_SETTLEMENT_FAILED", {
      requestId: input.requestId,
      reservationId: input.reservation.reservationId,
      code: "reservation_settlement_failed",
    })
  }
}

async function cleanAndSettleReservation(
  serviceClient: ReturnType<typeof createServiceRoleClient>,
  input: {
    reservation: AdvocateLogoUploadReservation
    actorUserId: string
    requestId: string
    failureCode: string
  },
): Promise<void> {
  const removed = await removeUploadedLogo(
    serviceClient,
    input.reservation.objectPath,
    input.requestId,
    input.reservation.reservationId,
  )
  await settleReservationFailure(serviceClient, {
    ...input,
    status: removed ? "cancelled" : "cleanup_required",
  })
}

function reservationFailureResponse(
  error: unknown,
  requestId: string,
): NextResponse {
  const postgresCode =
    error instanceof AdvocateLogoReservationDatabaseError
      ? error.postgresCode
      : undefined
  const failure = classifyAdvocateLogoReservationFailure(postgresCode)
  if (failure.status === 500) {
    console.error("ADVOCATE_PORTAL_LOGO_FAILED", {
      requestId,
      code: failure.code,
    })
  }
  return response({ ok: false, code: failure.code, requestId }, failure.status)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const requestId = randomUUID()
  const expectedOrigin = resolveTrustedPrimaryRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    expectedOrigin === null ||
    !isTrustedMultipartRequest(request, expectedOrigin)
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

  const { slug } = await params
  let portal
  try {
    const portals =
      await createAdvocatePortalAccessRepository(client).listForCurrentUser()
    portal = findAdvocatePortalAccessBySlug(portals, slug)
  } catch {
    console.error("ADVOCATE_PORTAL_LOGO_FAILED", {
      requestId,
      code: "access_unavailable",
    })
    return response({ ok: false, code: "logo_update_failed", requestId }, 500)
  }
  if (portal === null) {
    return response({ ok: false, code: "portal_not_found", requestId }, 404)
  }
  if (!portal.permissions.includes("portal.branding.update")) {
    return response({ ok: false, code: "forbidden", requestId }, 403)
  }
  if (
    portal.relationshipStatus !== "active" ||
    portal.publicationStatus === "suspended"
  ) {
    return response({ ok: false, code: "forbidden", requestId }, 403)
  }

  const contentType = request.headers.get("content-type")
  const rawBody = await readBoundedAdvocateLogoMultipartBody(request)
  if (rawBody === null || contentType === null) {
    return response({ ok: false, code: "invalid_request", requestId }, 400)
  }
  const upload = await parseAdvocateLogoUploadInput(
    rawBody,
    contentType,
    portal.slug,
  )
  if (upload === null) {
    return response({ ok: false, code: "invalid_request", requestId }, 400)
  }
  if (upload.branding.expectedVersion !== portal.advocateVersion) {
    return response({ ok: false, code: "version_conflict", requestId }, 409)
  }

  const traceId = boundedTraceId(request)
  const serviceClient = createServiceRoleClient()
  let reservation: AdvocateLogoUploadReservation
  try {
    reservation = await reserveAdvocateLogoUpload(serviceClient, {
      advocateId: portal.advocateId,
      actorUserId: user.id,
      expectedVersion: upload.branding.expectedVersion,
      slug: portal.slug,
      requestId,
      traceId,
    })
  } catch (error) {
    return reservationFailureResponse(error, requestId)
  }

  let processed
  try {
    processed = await processAdvocateLogo(upload.sourceBytes)
  } catch (error) {
    const code =
      error instanceof AdvocateLogoProcessingError
        ? error.code
        : "invalid_source"
    await settleReservationFailure(serviceClient, {
      reservation,
      actorUserId: user.id,
      requestId,
      status: "cancelled",
      failureCode: code,
    })
    return response({ ok: false, code, requestId }, 400)
  }

  const input = {
    ...upload.branding,
    logoStoragePath: reservation.objectPath,
  }
  let uploadData: { path?: string } | null = null
  try {
    const result = await serviceClient.storage
      .from(LOGO_BUCKET)
      .upload(reservation.objectPath, processed.bytes, {
        cacheControl: "31536000",
        contentType: processed.contentType,
        upsert: false,
      })
    uploadData = result.data
    if (result.error || uploadData?.path !== reservation.objectPath) {
      await cleanAndSettleReservation(serviceClient, {
        reservation,
        actorUserId: user.id,
        requestId,
        failureCode: "storage_upload_failed",
      })
      return response({ ok: false, code: "logo_upload_failed", requestId }, 500)
    }
  } catch {
    await cleanAndSettleReservation(serviceClient, {
      reservation,
      actorUserId: user.id,
      requestId,
      failureCode: "storage_upload_failed",
    })
    return response({ ok: false, code: "logo_upload_failed", requestId }, 500)
  }

  try {
    const advocateVersion = await updateAdvocateBranding(serviceClient, {
      advocateId: portal.advocateId,
      actorUserId: user.id,
      input,
      logoUploadReservationId: reservation.reservationId,
      requestId,
      traceId,
      sessionId: null,
    })
    return response({ ok: true, requestId, advocateVersion }, 200)
  } catch (error) {
    const postgresCode =
      error instanceof AdvocateBrandingDatabaseError
        ? error.postgresCode
        : undefined
    if (postgresCode === undefined) {
      try {
        const result = await getAdvocateLogoUploadReservationResult(
          serviceClient,
          {
            reservationId: reservation.reservationId,
            actorUserId: user.id,
            requestId,
            slug: portal.slug,
          },
        )
        if (
          result.status === "attached" &&
          result.objectPath === reservation.objectPath &&
          result.expectedVersion === input.expectedVersion &&
          result.resultingVersion === input.expectedVersion + 1
        ) {
          return response(
            {
              ok: true,
              requestId,
              advocateVersion: result.resultingVersion,
            },
            200,
          )
        }
      } catch {
        // Unknown provider or database state is left for durable reconciliation.
      }
      console.error("ADVOCATE_PORTAL_LOGO_RECONCILIATION_REQUIRED", {
        requestId,
        reservationId: reservation.reservationId,
        code: "branding_commit_ambiguous",
      })
      return response(
        { ok: false, code: "logo_reconciliation_pending", requestId },
        503,
      )
    }

    await cleanAndSettleReservation(serviceClient, {
      reservation,
      actorUserId: user.id,
      requestId,
      failureCode: `branding_${postgresCode.toLowerCase()}`,
    })
    const failure = classifyAdvocateBrandingUpdateFailure(postgresCode)
    if (failure.status === 500) {
      console.error("ADVOCATE_PORTAL_LOGO_FAILED", {
        requestId,
        code: "logo_update_failed",
      })
    }
    return response(
      {
        ok: false,
        code:
          failure.code === "branding_update_failed"
            ? "logo_update_failed"
            : failure.code,
        requestId,
      },
      failure.status,
    )
  }
}
