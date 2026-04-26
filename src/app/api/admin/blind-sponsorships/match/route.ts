import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import {
  autoMatchBlindSponsorships,
  matchBeneficiaryToOldestBlindSponsorship,
  matchByStripeSubscriptionId,
  matchSpecificSubscription,
  type MatchResult,
} from "@/utils/blindSponsorships/match"

export const runtime = "nodejs"

/**
 * API endpoint to match blind sponsorships with beneficiaries.
 *
 * Query params:
 * - subscriptionId: Match a specific blind sponsorship (internal ID)
 * - stripeSubscriptionId: Match a specific blind sponsorship (Stripe ID)
 * - beneficiaryId: Match to a specific beneficiary
 * - auto: Automatically match oldest blind sponsorship with best available beneficiary
 */
export async function POST(req: Request) {
  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const subscriptionId = searchParams.get("subscriptionId")
    const stripeSubscriptionId = searchParams.get("stripeSubscriptionId")
    const beneficiaryId = searchParams.get("beneficiaryId")
    const auto = searchParams.get("auto") === "true"

    if (stripeSubscriptionId) {
      return toResponse(
        await matchByStripeSubscriptionId(
          supabase,
          stripeSubscriptionId,
          beneficiaryId || undefined,
        ),
      )
    }

    if (subscriptionId) {
      return toResponse(
        await matchSpecificSubscription(
          supabase,
          subscriptionId,
          beneficiaryId || undefined,
        ),
      )
    }

    if (auto) {
      return toResponse(await autoMatchBlindSponsorships(supabase))
    }

    if (beneficiaryId) {
      return toResponse(
        await matchBeneficiaryToOldestBlindSponsorship(supabase, beneficiaryId),
      )
    }

    return NextResponse.json(
      { error: "Missing required parameters" },
      { status: 400 },
    )
  } catch (error) {
    console.error("Error matching blind sponsorship:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}

function toResponse(result: MatchResult): NextResponse {
  if (result.ok) {
    return NextResponse.json({
      success: true,
      subscription: result.subscription,
      beneficiary: result.beneficiary,
    })
  }
  const body: Record<string, unknown> = { error: result.error }
  if (result.details) body.details = result.details
  if (result.code) body.code = result.code
  return NextResponse.json(body, { status: result.status })
}
