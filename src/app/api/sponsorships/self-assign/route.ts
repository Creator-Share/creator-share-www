import { NextResponse } from "next/server"
import { sendBlindSponsorshipMatchedEmail } from "@/utils/email"
import { createClient } from "@/utils/supabase/server"

export const runtime = "nodejs"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface AssignmentResult {
  assignment_id: string
  subscription_id: string
  beneficiary_id: string
  beneficiary_name: string | null
  beneficiary_username: string | null
  subscription_amount_usd_cents: number
  billing_interval: string
  was_already_assigned: boolean
}

function boundedHeader(
  request: Request,
  headerName: string,
  maximumLength: number,
): string | null {
  const value = request.headers.get(headerName)?.trim()
  return value ? value.slice(0, maximumLength) : null
}

function requestContext(request: Request) {
  const requestId =
    boundedHeader(request, "x-request-id", 255) ?? crypto.randomUUID()
  const traceId =
    boundedHeader(request, "traceparent", 255) ??
    boundedHeader(request, "x-trace-id", 255)
  const clientIp =
    boundedHeader(request, "cf-connecting-ip", 256) ??
    boundedHeader(request, "x-vercel-forwarded-for", 256) ??
    boundedHeader(request, "x-forwarded-for", 256) ??
    boundedHeader(request, "x-real-ip", 256)

  return {
    requestId,
    traceId,
    clientIp,
    userAgent: boundedHeader(request, "user-agent", 1024),
  }
}

function errorResponseForAssignment(code: string | undefined) {
  switch (code) {
    case "22P02":
      return NextResponse.json(
        { error: "Invalid sponsorship assignment request" },
        { status: 400 },
      )
    case "22023":
      return NextResponse.json(
        { error: "Blind sponsorship or beneficiary not found" },
        { status: 404 },
      )
    case "42501":
      return NextResponse.json(
        { error: "You cannot assign this sponsorship" },
        { status: 403 },
      )
    case "23505":
      return NextResponse.json(
        { error: "This sponsorship is already assigned" },
        { status: 409 },
      )
    case "23514":
      return NextResponse.json(
        { error: "This sponsorship or beneficiary is no longer available" },
        { status: 409 },
      )
    default:
      return NextResponse.json(
        { error: "Failed to assign the sponsorship" },
        { status: 500 },
      )
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return NextResponse.json({ error: "Request is too large" }, { status: 413 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON request" }, { status: 400 })
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "A subscription and beneficiary are required" },
      { status: 400 },
    )
  }

  const subscriptionId = Reflect.get(body, "subscriptionId")
  const beneficiaryId = Reflect.get(body, "beneficiaryId")

  if (
    typeof subscriptionId !== "string" ||
    !UUID_PATTERN.test(subscriptionId) ||
    typeof beneficiaryId !== "string" ||
    !UUID_PATTERN.test(beneficiaryId)
  ) {
    return NextResponse.json(
      { error: "Valid subscription and beneficiary identifiers are required" },
      { status: 400 },
    )
  }

  const context = requestContext(request)
  const { data, error } = await supabase.rpc(
    "assign_blind_sponsorship_beneficiary",
    {
      target_subscription_id: subscriptionId,
      target_beneficiary_id: beneficiaryId,
      context_request_id: context.requestId,
      context_trace_id: context.traceId,
      context_client_ip: context.clientIp,
      context_user_agent: context.userAgent,
    },
  )

  if (error) {
    console.error("Blind sponsorship assignment failed", {
      code: error.code,
      requestId: context.requestId,
    })
    return errorResponseForAssignment(error.code)
  }

  const assignment = (data as AssignmentResult[] | null)?.[0]
  if (!assignment) {
    console.error("Blind sponsorship assignment returned no result", {
      requestId: context.requestId,
    })
    return NextResponse.json(
      { error: "Failed to assign the sponsorship" },
      { status: 500 },
    )
  }

  if (!assignment.was_already_assigned && user.email) {
    const { data: profile } = await supabase
      .from("users")
      .select("first_name, last_name")
      .eq("id", user.id)
      .maybeSingle()
    const sponsorName = [profile?.first_name, profile?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim()

    try {
      await sendBlindSponsorshipMatchedEmail(
        user.email,
        assignment.beneficiary_name ?? "a child",
        assignment.subscription_amount_usd_cents,
        assignment.billing_interval,
        sponsorName || null,
        assignment.beneficiary_username,
        assignment.beneficiary_id,
      )
    } catch (emailError) {
      console.error("Blind sponsorship assignment email failed", {
        requestId: context.requestId,
        errorName:
          emailError instanceof Error ? emailError.name : "UnknownEmailError",
      })
    }
  }

  return NextResponse.json({
    success: true,
    assignment: {
      subscriptionId: assignment.subscription_id,
      beneficiary: {
        id: assignment.beneficiary_id,
        name: assignment.beneficiary_name,
        username: assignment.beneficiary_username,
      },
      amountUsdCents: assignment.subscription_amount_usd_cents,
      billingInterval: assignment.billing_interval,
      wasAlreadyAssigned: assignment.was_already_assigned,
    },
  })
}
