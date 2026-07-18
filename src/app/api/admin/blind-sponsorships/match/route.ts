import { NextResponse } from "next/server"
import { WAITING_STATUSES } from "@/config/beneficiaryStatuses"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { sendBlindSponsorshipMatchedEmail } from "@/utils/email"
import { createClient } from "@/utils/supabase/server"

export const runtime = "nodejs"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const STRIPE_SUBSCRIPTION_PATTERN = /^sub_[A-Za-z0-9]{1,251}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const ALLOWED_QUERY_PARAMETERS = new Set([
  "subscriptionId",
  "stripeSubscriptionId",
  "beneficiaryId",
  "auto",
  "reason",
])

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

function isAssignmentResult(
  value: unknown,
  expectedSubscriptionId: string,
  expectedBeneficiaryId: string,
): value is AssignmentResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false

  const result = value as Partial<AssignmentResult>
  return (
    typeof result.assignment_id === "string" &&
    UUID_PATTERN.test(result.assignment_id) &&
    result.subscription_id === expectedSubscriptionId &&
    result.beneficiary_id === expectedBeneficiaryId &&
    (result.beneficiary_name === null ||
      typeof result.beneficiary_name === "string") &&
    (result.beneficiary_username === null ||
      typeof result.beneficiary_username === "string") &&
    typeof result.subscription_amount_usd_cents === "number" &&
    Number.isSafeInteger(result.subscription_amount_usd_cents) &&
    result.subscription_amount_usd_cents > 0 &&
    (result.billing_interval === "month" || result.billing_interval === "year") &&
    typeof result.was_already_assigned === "boolean"
  )
}

interface SponsorProfile {
  email?: string | null
  first_name?: string | null
  last_name?: string | null
}

interface SponsorContactRow {
  email?: string | null
  users?: SponsorProfile | SponsorProfile[] | null
}

interface RequestContext {
  requestId: string
  traceId: string | null
  clientIp: string | null
  userAgent: string | null
}

type MatchMode =
  | "specific_subscription"
  | "stripe_subscription"
  | "automatic"
  | "specific_beneficiary"

function boundedHeader(
  request: Request,
  headerName: string,
  maximumLength: number,
): string | null {
  const value = request.headers.get(headerName)?.trim()
  return value ? value.slice(0, maximumLength) : null
}

function getRequestContext(request: Request): RequestContext {
  return {
    requestId:
      boundedHeader(request, "x-request-id", 255) ?? crypto.randomUUID(),
    traceId:
      boundedHeader(request, "traceparent", 255) ??
      boundedHeader(request, "x-trace-id", 255) ??
      boundedHeader(request, "x-vercel-id", 255),
    clientIp:
      boundedHeader(request, "cf-connecting-ip", 256) ??
      boundedHeader(request, "x-vercel-forwarded-for", 256) ??
      boundedHeader(request, "x-forwarded-for", 256) ??
      boundedHeader(request, "x-real-ip", 256),
    userAgent: boundedHeader(request, "user-agent", 1024),
  }
}

function readSingleQueryParameter(
  searchParams: URLSearchParams,
  name: string,
): string | null {
  const values = searchParams.getAll(name)
  if (values.length > 1) {
    throw new RequestValidationError(`Query parameter ${name} was repeated`)
  }
  return values[0] ?? null
}

class RequestValidationError extends Error {}

function parseReason(value: string | null): string | null {
  if (value === null) return null

  const reason = value.trim()
  if (
    reason.length < 5 ||
    reason.length > 1000 ||
    CONTROL_CHARACTER_PATTERN.test(reason)
  ) {
    throw new RequestValidationError(
      "The administrative reason must contain 5 to 1000 plain text characters",
    )
  }

  return reason
}

function generatedReason(mode: MatchMode, selectedBeneficiary: boolean) {
  switch (mode) {
    case "specific_subscription":
      return selectedBeneficiary
        ? "Creator Share administrator matched a specified blind sponsorship to a specified beneficiary"
        : "Creator Share administrator matched a specified blind sponsorship to the highest priority eligible beneficiary"
    case "stripe_subscription":
      return selectedBeneficiary
        ? "Creator Share administrator matched a blind sponsorship found by its Stripe subscription reference to a specified beneficiary"
        : "Creator Share administrator matched a blind sponsorship found by its Stripe subscription reference to the highest priority eligible beneficiary"
    case "automatic":
      return "Creator Share administrator matched the oldest blind sponsorship to the highest priority eligible beneficiary"
    case "specific_beneficiary":
      return "Creator Share administrator matched the oldest blind sponsorship to a specified beneficiary"
  }
}

function assignmentErrorResponse(code: string | undefined) {
  switch (code) {
    case "22P02":
    case "22023":
      return NextResponse.json(
        { error: "Blind sponsorship or beneficiary not found" },
        { status: 404 },
      )
    case "42501":
      return NextResponse.json(
        { error: "This administrative assignment is not permitted" },
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
    case "40001":
      return NextResponse.json(
        { error: "The assignment changed concurrently. Please retry." },
        { status: 409 },
      )
    default:
      return NextResponse.json(
        { error: "Failed to assign the blind sponsorship" },
        { status: 500 },
      )
  }
}

async function findSubscriptionByStripeReference(
  supabase: SupabaseClient,
  stripeSubscriptionId: string,
  context: RequestContext,
): Promise<string | NextResponse> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .limit(2)

  if (error) {
    console.error("Blind sponsorship reference lookup failed", {
      code: error.code,
      requestId: context.requestId,
    })
    return NextResponse.json(
      { error: "Failed to find the blind sponsorship" },
      { status: 500 },
    )
  }

  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "Blind sponsorship not found" },
      { status: 404 },
    )
  }

  if (data.length !== 1) {
    console.error("Blind sponsorship reference was ambiguous", {
      requestId: context.requestId,
    })
    return NextResponse.json(
      { error: "Blind sponsorship reference is ambiguous" },
      { status: 409 },
    )
  }

  return String(data[0].id)
}

async function findOldestBlindSponsorship(
  supabase: SupabaseClient,
  context: RequestContext,
): Promise<string | NextResponse> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("id")
    .is("beneficiary_id", null)
    .eq("status", "complete")
    .or("subject_kind.eq.blind,and(subject_kind.is.null,sponsorship_intent_id.is.null)")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("Oldest blind sponsorship lookup failed", {
      code: error.code,
      requestId: context.requestId,
    })
    return NextResponse.json(
      { error: "Failed to find an available blind sponsorship" },
      { status: 500 },
    )
  }

  if (!data) {
    return NextResponse.json(
      { error: "No blind sponsorships found to match" },
      { status: 404 },
    )
  }

  return String(data.id)
}

async function findBestBeneficiaryMatch(
  supabase: SupabaseClient,
  context: RequestContext,
): Promise<string | NextResponse> {
  const { data, error } = await supabase
    .from("beneficiaries")
    .select("id, budget_goal, budget_raised")
    .or("beneficiary_type.eq.CHILD,beneficiary_type.is.null")
    .eq("status", "New")
    .is("goal_fulfilled_at", null)
    .eq("active_subscriptions", 0)
    .order("sort_weight", { ascending: false })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(10)

  if (error) {
    console.error("Blind sponsorship beneficiary lookup failed", {
      code: error.code,
      requestId: context.requestId,
    })
    return NextResponse.json(
      { error: "Failed to find an available beneficiary" },
      { status: 500 },
    )
  }

  const beneficiary = data?.find((candidate) => {
    const goal = Number(candidate.budget_goal ?? 0)
    const raised = Number(candidate.budget_raised ?? 0)
    return Number.isFinite(goal) && Number.isFinite(raised) && goal - raised > 0
  })

  if (!beneficiary) {
    return NextResponse.json(
      { error: "No available beneficiary found for matching" },
      { status: 404 },
    )
  }

  return String(beneficiary.id)
}

async function ensureSelectedBeneficiaryExists(
  supabase: SupabaseClient,
  beneficiaryId: string,
  context: RequestContext,
): Promise<NextResponse | null> {
  const waitingStatuses = WAITING_STATUSES.map((status) => `"${status}"`).join(
    ",",
  )
  const { data, error } = await supabase
    .from("beneficiaries")
    .select("id")
    .eq("id", beneficiaryId)
    .or(
      `status.in.(${waitingStatuses}),and(budget_goal.eq.-1,status.not.in.(Draft,Archived))`,
    )
    .maybeSingle()

  if (error) {
    console.error("Selected beneficiary lookup failed", {
      code: error.code,
      requestId: context.requestId,
    })
    return NextResponse.json(
      { error: "Failed to find the selected beneficiary" },
      { status: 500 },
    )
  }

  if (!data) {
    return NextResponse.json(
      { error: "Beneficiary not found or not available for sponsorship" },
      { status: 404 },
    )
  }

  return null
}

async function getSponsorContact(
  supabase: SupabaseClient,
  subscriptionId: string,
  context: RequestContext,
): Promise<{ email: string; name: string | null } | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("email, users(email, first_name, last_name)")
    .eq("id", subscriptionId)
    .maybeSingle()

  if (error) {
    console.error("Blind sponsorship contact lookup failed", {
      code: error.code,
      requestId: context.requestId,
    })
    return null
  }

  const row = data as SponsorContactRow | null
  const relatedProfile = Array.isArray(row?.users) ? row.users[0] : row?.users
  const email = relatedProfile?.email?.trim() || row?.email?.trim()
  if (!email) return null

  const name = [relatedProfile?.first_name, relatedProfile?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim()

  return { email, name: name || null }
}

async function sendNewAssignmentEmail(
  supabase: SupabaseClient,
  assignment: AssignmentResult,
  context: RequestContext,
) {
  if (assignment.was_already_assigned) return

  const sponsor = await getSponsorContact(
    supabase,
    assignment.subscription_id,
    context,
  )
  if (!sponsor) return

  try {
    await sendBlindSponsorshipMatchedEmail(
      sponsor.email,
      assignment.beneficiary_name ?? "a child",
      assignment.subscription_amount_usd_cents,
      assignment.billing_interval,
      sponsor.name,
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

async function assignBlindSponsorship(
  supabase: SupabaseClient,
  subscriptionId: string,
  beneficiaryId: string,
  reason: string,
  context: RequestContext,
) {
  const { data, error } = await supabase.rpc(
    "assign_blind_sponsorship_beneficiary_admin",
    {
      target_subscription_id: subscriptionId,
      target_beneficiary_id: beneficiaryId,
      change_reason: reason,
      context_request_id: context.requestId,
      context_trace_id: context.traceId,
      context_client_ip: context.clientIp,
      context_user_agent: context.userAgent,
    },
  )

  if (error) {
    console.error("Blind sponsorship administrative assignment failed", {
      code: error.code,
      requestId: context.requestId,
    })
    return assignmentErrorResponse(error.code)
  }

  const assignment = Array.isArray(data) ? data[0] : null
  if (!isAssignmentResult(assignment, subscriptionId, beneficiaryId)) {
    console.error("Blind sponsorship assignment returned an invalid result", {
      requestId: context.requestId,
    })
    return NextResponse.json(
      { error: "Failed to assign the blind sponsorship" },
      { status: 500 },
    )
  }

  await sendNewAssignmentEmail(supabase, assignment, context)

  return NextResponse.json({
    success: true,
    assignment: {
      subscriptionId: assignment.subscription_id,
      beneficiary: {
        id: assignment.beneficiary_id,
        name: assignment.beneficiary_name,
        username: assignment.beneficiary_username,
      },
      wasAlreadyAssigned: assignment.was_already_assigned,
    },
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response

  const context = getRequestContext(request)

  try {
    const { searchParams } = new URL(request.url)
    for (const name of searchParams.keys()) {
      if (!ALLOWED_QUERY_PARAMETERS.has(name)) {
        throw new RequestValidationError(`Unknown query parameter ${name}`)
      }
    }

    const subscriptionId = readSingleQueryParameter(
      searchParams,
      "subscriptionId",
    )
    const stripeSubscriptionId = readSingleQueryParameter(
      searchParams,
      "stripeSubscriptionId",
    )
    const beneficiaryId = readSingleQueryParameter(
      searchParams,
      "beneficiaryId",
    )
    const autoValue = readSingleQueryParameter(searchParams, "auto")
    const suppliedReason = parseReason(
      readSingleQueryParameter(searchParams, "reason"),
    )

    if (subscriptionId !== null && !UUID_PATTERN.test(subscriptionId)) {
      throw new RequestValidationError("Subscription identifier is invalid")
    }
    if (beneficiaryId !== null && !UUID_PATTERN.test(beneficiaryId)) {
      throw new RequestValidationError("Beneficiary identifier is invalid")
    }
    if (
      stripeSubscriptionId !== null &&
      !STRIPE_SUBSCRIPTION_PATTERN.test(stripeSubscriptionId)
    ) {
      throw new RequestValidationError("Stripe subscription reference is invalid")
    }
    if (autoValue !== null && autoValue !== "true" && autoValue !== "false") {
      throw new RequestValidationError("Auto must be true or false")
    }

    const auto = autoValue === "true"
    if (subscriptionId && stripeSubscriptionId) {
      throw new RequestValidationError(
        "Choose one subscription identifier, not both",
      )
    }
    if (auto && (subscriptionId || stripeSubscriptionId || beneficiaryId)) {
      throw new RequestValidationError(
        "Automatic matching cannot be combined with a specific subscription or beneficiary",
      )
    }

    let mode: MatchMode
    let resolvedSubscriptionId: string
    let resolvedBeneficiaryId: string

    if (subscriptionId) {
      mode = "specific_subscription"
      resolvedSubscriptionId = subscriptionId
    } else if (stripeSubscriptionId) {
      mode = "stripe_subscription"
      const result = await findSubscriptionByStripeReference(
        supabase,
        stripeSubscriptionId,
        context,
      )
      if (result instanceof NextResponse) return result
      resolvedSubscriptionId = result
    } else if (auto) {
      mode = "automatic"
      const result = await findOldestBlindSponsorship(supabase, context)
      if (result instanceof NextResponse) return result
      resolvedSubscriptionId = result
    } else if (beneficiaryId) {
      mode = "specific_beneficiary"
      const result = await findOldestBlindSponsorship(supabase, context)
      if (result instanceof NextResponse) return result
      resolvedSubscriptionId = result
    } else {
      throw new RequestValidationError(
        "A subscription, beneficiary, or automatic match is required",
      )
    }

    if (beneficiaryId) {
      const beneficiaryError = await ensureSelectedBeneficiaryExists(
        supabase,
        beneficiaryId,
        context,
      )
      if (beneficiaryError) return beneficiaryError
      resolvedBeneficiaryId = beneficiaryId
    } else {
      const result = await findBestBeneficiaryMatch(supabase, context)
      if (result instanceof NextResponse) return result
      resolvedBeneficiaryId = result
    }

    const reason =
      suppliedReason ?? generatedReason(mode, beneficiaryId !== null)

    return await assignBlindSponsorship(
      supabase,
      resolvedSubscriptionId,
      resolvedBeneficiaryId,
      reason,
      context,
    )
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    console.error("Blind sponsorship matching request failed", {
      requestId: context.requestId,
      errorName: error instanceof Error ? error.name : "UnknownRequestError",
    })
    return NextResponse.json(
      { error: "Failed to match the blind sponsorship" },
      { status: 500 },
    )
  }
}
