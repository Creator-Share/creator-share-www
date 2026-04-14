import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { sendBlindSponsorshipMatchedEmail } from "@/utils/email"
import { WAITING_STATUSES } from "@/config/beneficiaryStatuses"
import { isOpenSponsorshipType } from "@/config/beneficiaryTypes"

export const runtime = "nodejs"

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

/**
 * API endpoint to match blind sponsorships with beneficiaries
 * 
 * This can be called:
 * 1. Manually by admin
 * 2. Automatically when a new beneficiary is created
 * 3. Via a cron job/scheduled task
 * 
 * Query params:
 * - subscriptionId: Match a specific blind sponsorship
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

    // If Stripe subscription ID provided, look up database ID first
    if (stripeSubscriptionId) {
      const { data: subscription } = await supabase
        .from("subscriptions")
        .select("id")
        .eq("stripe_subscription_id", stripeSubscriptionId)
        .single()
      
      if (subscription) {
        return await matchSpecificSubscription(
          supabase,
          subscription.id,
          beneficiaryId || undefined,
        )
      }
      
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 },
      )
    }

    // If specific subscription ID provided, match that one
    if (subscriptionId) {
      return await matchSpecificSubscription(
        supabase,
        subscriptionId,
        beneficiaryId || undefined,
      )
    }

    // If auto mode, match oldest blind sponsorship with best available beneficiary
    if (auto) {
      return await autoMatchBlindSponsorships(supabase)
    }

    // If beneficiary ID provided but no subscription, find oldest blind sponsorship
    if (beneficiaryId) {
      return await matchBeneficiaryToOldestBlindSponsorship(
        supabase,
        beneficiaryId,
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

async function matchSpecificSubscription(
  supabase: SupabaseClient,
  subscriptionId: string,
  beneficiaryId?: string,
) {
  // Get the blind sponsorship
  const { data: subscription, error: subError } = await supabase
    .from("subscriptions")
    .select("*, users(email, first_name, last_name)")
    .eq("id", subscriptionId)
    .is("beneficiary_id", null)
    .eq("status", "complete")
    .single()

  if (subError || !subscription) {
    return NextResponse.json(
      { error: "Blind sponsorship not found or already matched" },
      { status: 404 },
    )
  }

  // If beneficiary ID provided, use that; otherwise find best match
  const targetBeneficiaryId = beneficiaryId || await findBestBeneficiaryMatch(supabase)

  if (!targetBeneficiaryId) {
    return NextResponse.json(
      { error: "No available beneficiary found for matching" },
      { status: 404 },
    )
  }

  // Update subscription with beneficiary
  const { data: updatedSubscription, error: updateError } = await supabase
    .from("subscriptions")
    .update({ beneficiary_id: targetBeneficiaryId })
    .eq("id", subscriptionId)
    .select()
    .single()

  if (updateError) {
    console.error("Error updating subscription:", {
      subscriptionId,
      targetBeneficiaryId,
      error: updateError,
      message: updateError.message,
      details: updateError.details,
      hint: updateError.hint,
      code: updateError.code
    })
    return NextResponse.json(
      { 
        error: "Failed to update subscription",
        details: updateError.message,
        code: updateError.code
      },
      { status: 500 },
    )
  }

  // Get beneficiary details for email
  const { data: beneficiary } = await supabase
    .from("beneficiaries")
    .select("name, username")
    .eq("id", targetBeneficiaryId)
    .single()

  if (!beneficiary) {
    return NextResponse.json(
      { error: "Beneficiary not found" },
      { status: 404 },
    )
  }

  // Send notification email
  const user = subscription.users as { email?: string; first_name?: string; last_name?: string } | null
  if (user?.email) {
    try {
      await sendBlindSponsorshipMatchedEmail(
        user.email,
        beneficiary.name || "a child",
        subscription.amount || 0,
        subscription.interval || "month",
        user.first_name || user.last_name ? `${user.first_name || ""} ${user.last_name || ""}`.trim() : null,
        beneficiary.username,
        targetBeneficiaryId,
      )
    } catch (emailError) {
      console.error("Error sending match notification email:", emailError)
      // Don't fail the request if email fails
    }
  }

  return NextResponse.json({
    success: true,
    subscription: updatedSubscription,
    beneficiary: beneficiary,
  })
}

/**
 * Automatically match the oldest blind sponsorship with the best available beneficiary
 */
async function autoMatchBlindSponsorships(
  supabase: SupabaseClient,
) {
  // Get oldest blind sponsorship
  const { data: blindSponsorships, error: subError } = await supabase
    .from("subscriptions")
    .select("*, users(email, first_name, last_name)")
    .is("beneficiary_id", null)
    .eq("status", "complete")
    .order("created_at", { ascending: true })
    .limit(1)

  if (subError || !blindSponsorships || blindSponsorships.length === 0) {
    return NextResponse.json(
      { error: "No blind sponsorships found to match" },
      { status: 404 },
    )
  }

  const subscription = blindSponsorships[0]

  // Find best beneficiary match
  const beneficiaryId = await findBestBeneficiaryMatch(
    supabase
  )

  if (!beneficiaryId) {
    return NextResponse.json(
      { error: "No available beneficiary found for matching" },
      { status: 404 },
    )
  }

  // Update subscription
  const { data: updatedSubscription, error: updateError } = await supabase
    .from("subscriptions")
    .update({ beneficiary_id: beneficiaryId })
    .eq("id", subscription.id)
    .select()
    .single()

  if (updateError) {
    console.error("Error updating subscription:", updateError)
    return NextResponse.json(
      { error: "Failed to update subscription" },
      { status: 500 },
    )
  }

  // Get beneficiary details
  const { data: beneficiary } = await supabase
    .from("beneficiaries")
    .select("name, username")
    .eq("id", beneficiaryId)
    .single()

  if (!beneficiary) {
    return NextResponse.json(
      { error: "Beneficiary not found" },
      { status: 404 },
    )
  }

  // Send notification email
  const user = subscription.users as { email?: string; first_name?: string; last_name?: string } | null
  if (user?.email) {
    try {
      await sendBlindSponsorshipMatchedEmail(
        user.email,
        beneficiary.name || "a child",
        subscription.amount || 0,
        subscription.interval || "month",
        user.first_name || user.last_name ? `${user.first_name || ""} ${user.last_name || ""}`.trim() : null,
        beneficiary.username,
        beneficiaryId,
      )
    } catch (emailError) {
      console.error("Error sending match notification email:", emailError)
    }
  }

  return NextResponse.json({
    success: true,
    subscription: updatedSubscription,
    beneficiary: beneficiary,
  })
}

/**
 * Match a specific beneficiary to the oldest blind sponsorship
 */
async function matchBeneficiaryToOldestBlindSponsorship(
  supabase: SupabaseClient,
  beneficiaryId: string,
) {
  // Verify beneficiary exists and is available
  const { data: beneficiary, error: benError } = await supabase
    .from("beneficiaries")
    .select("id, name, username, status, budget_goal, budget_raised, beneficiary_type")
    .eq("id", beneficiaryId)
    .or(`status.in.(${WAITING_STATUSES.join(",")}),and(budget_goal.eq.-1,status.not.in.(Draft,Archived))`)
    .single()

  if (benError || !beneficiary) {
    return NextResponse.json(
      { error: "Beneficiary not found or not available for sponsorship" },
      { status: 404 },
    )
  }

  // Get oldest blind sponsorship
  const { data: blindSponsorships, error: subError } = await supabase
    .from("subscriptions")
    .select("*, users(email, first_name, last_name)")
    .is("beneficiary_id", null)
    .eq("status", "complete")
    .order("created_at", { ascending: true })
    .limit(1)

  if (subError || !blindSponsorships || blindSponsorships.length === 0) {
    return NextResponse.json(
      { error: "No blind sponsorships found to match" },
      { status: 404 },
    )
  }

  const subscription = blindSponsorships[0]

  // Update subscription
  const { data: updatedSubscription, error: updateError } = await supabase
    .from("subscriptions")
    .update({ beneficiary_id: beneficiaryId })
    .eq("id", subscription.id)
    .select()
    .single()

  if (updateError) {
    console.error("Error updating subscription:", updateError)
    return NextResponse.json(
      { error: "Failed to update subscription" },
      { status: 500 },
    )
  }

  // Send notification email
  const user = subscription.users as { email?: string; first_name?: string; last_name?: string } | null
  if (user?.email) {
    try {
      await sendBlindSponsorshipMatchedEmail(
        user.email,
        beneficiary.name || "a child",
        subscription.amount || 0,
        subscription.interval || "month",
        user.first_name || user.last_name ? `${user.first_name || ""} ${user.last_name || ""}`.trim() : null,
        beneficiary.username,
        beneficiaryId,
      )
    } catch (emailError) {
      console.error("Error sending match notification email:", emailError)
    }
  }

  return NextResponse.json({
    success: true,
    subscription: updatedSubscription,
    beneficiary: beneficiary,
  })
}

/**
 * Find the best beneficiary match for a blind sponsorship
 * Priority:
 * 1. Status: "New" (no active subscriptions yet)
 * 2. Sort by: sort_weight DESC (higher priority), then created_at ASC (oldest first)
 * 3. Not already fulfilled
 * 4. Does NOT have any active subscriptions (due to unique constraint)
 */
async function findBestBeneficiaryMatch(
  supabase: SupabaseClient
): Promise<string | null> {
  // Get beneficiaries with NO active subscriptions
  const { data: beneficiaries, error } = await supabase
    .from("beneficiaries")
    .select("id, name, status, budget_goal, budget_raised, sort_weight, beneficiary_type")
    .or("beneficiary_type.eq.CHILD,beneficiary_type.is.null")
    .eq("status", "New") // Only "New" beneficiaries have no active subscriptions
    .is("goal_fulfilled_at", null)
    .eq("active_subscriptions", 0) // Explicitly check for 0 active subscriptions
    .order("sort_weight", { ascending: false }) // Higher weight = higher priority
    .order("created_at", { ascending: true }) // Oldest first
    .limit(10) // Get top candidates

  if (error) {
    console.error("Error finding beneficiary match:", error)
    return null
  }

  if (!beneficiaries || beneficiaries.length === 0) {
    return null
  }

  // Find the first beneficiary that still needs funding
  // Open sponsorship types (budget_goal = -1) are always available
  for (const beneficiary of beneficiaries) {
    if (isOpenSponsorshipType(beneficiary.beneficiary_type)) return beneficiary.id
    const remaining = (beneficiary.budget_goal || 0) - (beneficiary.budget_raised || 0)
    if (remaining > 0) {
      return beneficiary.id
    }
  }

  return null
}
