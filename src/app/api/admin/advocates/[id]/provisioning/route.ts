import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import {
  classifyAdvocateProvisioningStartFailure,
  deriveAdvocateProvisioningRequestId,
  isJsonRequestContentType,
  parseAdvocateProvisioningStartInput,
  parseAdvocateProvisioningStartResult,
  readBoundedProvisioningStartBody,
} from "@/lib/advocates/provisioning/start"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { createClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function response(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  })
}

function boundedTraceId(request: Request): string {
  for (const name of ["traceparent", "x-trace-id", "x-vercel-id"]) {
    const value = request.headers.get(name)?.trim()
    if (value && value.length <= 255 && !/[\u0000-\u001f\u007f]/.test(value)) {
      return value
    }
  }
  return `advocate-provisioning-start:${randomUUID()}`
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let requestId: string = randomUUID()
  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response

  const { id: advocateId } = await params
  if (!UUID_PATTERN.test(advocateId)) {
    return response({ ok: false, code: "invalid_request", requestId }, 400)
  }

  if (!isJsonRequestContentType(request.headers.get("content-type"))) {
    return response({ ok: false, code: "invalid_request", requestId }, 400)
  }

  const rawBody = await readBoundedProvisioningStartBody(request)
  if (rawBody === null) {
    return response({ ok: false, code: "invalid_request", requestId }, 400)
  }
  const input = parseAdvocateProvisioningStartInput(rawBody)
  if (input === null) {
    return response({ ok: false, code: "invalid_request", requestId }, 400)
  }

  const deterministicRequestId = deriveAdvocateProvisioningRequestId({
    actorUserId: auth.user.id,
    advocateId,
    expectedVersion: input.expectedVersion,
  })
  if (deterministicRequestId === null) {
    console.error("ADVOCATE_PROVISIONING_START_FAILED", {
      requestId,
      code: "invalid_identity",
    })
    return response({ ok: false, code: "provisioning_failed", requestId }, 500)
  }
  requestId = deterministicRequestId

  const { data, error } = await supabase.rpc(
    "start_advocate_portal_provisioning",
    {
      target_advocate_id: advocateId,
      expected_advocate_version: input.expectedVersion,
      request_id: requestId,
      trace_id: boundedTraceId(request),
    },
  )
  if (error) {
    const failure = classifyAdvocateProvisioningStartFailure(error.code)
    if (failure.status === 500) {
      console.error("ADVOCATE_PROVISIONING_START_FAILED", {
        requestId,
        code: failure.code,
      })
    }
    return response(
      { ok: false, code: failure.code, requestId },
      failure.status,
    )
  }

  const result = parseAdvocateProvisioningStartResult(data, {
    advocateId,
    expectedVersion: input.expectedVersion,
  })
  if (result === null) {
    console.error("ADVOCATE_PROVISIONING_START_FAILED", {
      requestId,
      code: "invalid_result",
    })
    return response({ ok: false, code: "provisioning_failed", requestId }, 500)
  }

  return response({ ok: true, requestId, provisioning: result }, 202)
}
