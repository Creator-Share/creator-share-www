import type { SupabaseClient } from "@supabase/supabase-js"
import { sendBlindSponsorshipMatchedEmail } from "@/utils/email"
import { WAITING_STATUSES } from "@/config/beneficiaryStatuses"

type SubscriptionRow = {
  id: string
  amount: number | null
  interval: string | null
  users: { email?: string; first_name?: string; last_name?: string } | null
}

type BeneficiaryRow = {
  id: string
  name: string | null
  username: string | null
}

export type MatchSuccess = {
  ok: true
  subscription: Record<string, unknown>
  beneficiary: BeneficiaryRow
}

export type MatchFailure = {
  ok: false
  error: string
  status: number
  details?: string
  code?: string
}

export type MatchResult = MatchSuccess | MatchFailure

/**
 * Match a specific blind sponsorship (by internal subscription ID) to a beneficiary.
 * If beneficiaryId is omitted, picks the best available beneficiary.
 */
export async function matchSpecificSubscription(
  supabase: SupabaseClient,
  subscriptionId: string,
  beneficiaryId?: string,
): Promise<MatchResult> {
  const { data: subscription, error: subError } = await supabase
    .from("subscriptions")
    .select("*, users(email, first_name, last_name)")
    .eq("id", subscriptionId)
    .is("beneficiary_id", null)
    .eq("status", "complete")
    .single<SubscriptionRow & Record<string, unknown>>()

  if (subError || !subscription) {
    return {
      ok: false,
      error: "Blind sponsorship not found or already matched",
      status: 404,
    }
  }

  const targetBeneficiaryId =
    beneficiaryId || (await findBestBeneficiaryMatch(supabase))

  if (!targetBeneficiaryId) {
    return {
      ok: false,
      error: "No available beneficiary found for matching",
      status: 404,
    }
  }

  return finalizeMatch(supabase, subscription, targetBeneficiaryId)
}

/**
 * Look up a subscription by Stripe subscription ID, then match it.
 * This is the entry point used by the Stripe webhook on checkout completion.
 */
export async function matchByStripeSubscriptionId(
  supabase: SupabaseClient,
  stripeSubscriptionId: string,
  beneficiaryId?: string,
): Promise<MatchResult> {
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .single<{ id: string }>()

  if (!subscription) {
    return { ok: false, error: "Subscription not found", status: 404 }
  }

  return matchSpecificSubscription(supabase, subscription.id, beneficiaryId)
}

/**
 * Match the oldest unmatched blind sponsorship to the best available beneficiary.
 */
export async function autoMatchBlindSponsorships(
  supabase: SupabaseClient,
): Promise<MatchResult> {
  const subscription = await getOldestBlindSponsorship(supabase)
  if (!subscription) {
    return {
      ok: false,
      error: "No blind sponsorships found to match",
      status: 404,
    }
  }

  const beneficiaryId = await findBestBeneficiaryMatch(supabase)
  if (!beneficiaryId) {
    return {
      ok: false,
      error: "No available beneficiary found for matching",
      status: 404,
    }
  }

  return finalizeMatch(supabase, subscription, beneficiaryId)
}

/**
 * Match a specific available beneficiary to the oldest unmatched blind sponsorship.
 */
export async function matchBeneficiaryToOldestBlindSponsorship(
  supabase: SupabaseClient,
  beneficiaryId: string,
): Promise<MatchResult> {
  const { data: beneficiary, error: benError } = await supabase
    .from("beneficiaries")
    .select("id, name, username, status, budget_goal, budget_raised, beneficiary_type")
    .eq("id", beneficiaryId)
    .or(
      `status.in.(${WAITING_STATUSES.map((s) => `"${s}"`).join(",")}),and(budget_goal.eq.-1,status.not.in.(Draft,Archived))`,
    )
    .single()

  if (benError || !beneficiary) {
    return {
      ok: false,
      error: "Beneficiary not found or not available for sponsorship",
      status: 404,
    }
  }

  const subscription = await getOldestBlindSponsorship(supabase)
  if (!subscription) {
    return {
      ok: false,
      error: "No blind sponsorships found to match",
      status: 404,
    }
  }

  return finalizeMatch(supabase, subscription, beneficiaryId)
}

async function getOldestBlindSponsorship(
  supabase: SupabaseClient,
): Promise<(SubscriptionRow & Record<string, unknown>) | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*, users(email, first_name, last_name)")
    .is("beneficiary_id", null)
    .eq("status", "complete")
    .order("created_at", { ascending: true })
    .limit(1)

  if (error || !data || data.length === 0) return null
  return data[0] as SubscriptionRow & Record<string, unknown>
}

async function finalizeMatch(
  supabase: SupabaseClient,
  subscription: SubscriptionRow & Record<string, unknown>,
  beneficiaryId: string,
): Promise<MatchResult> {
  const { data: updatedSubscription, error: updateError } = await supabase
    .from("subscriptions")
    .update({ beneficiary_id: beneficiaryId })
    .eq("id", subscription.id)
    .select()
    .single()

  if (updateError) {
    console.error("Error updating subscription:", {
      subscriptionId: subscription.id,
      beneficiaryId,
      error: updateError,
      message: updateError.message,
      details: updateError.details,
      hint: updateError.hint,
      code: updateError.code,
    })
    return {
      ok: false,
      error: "Failed to update subscription",
      status: 500,
      details: updateError.message,
      code: updateError.code,
    }
  }

  const { data: beneficiary } = await supabase
    .from("beneficiaries")
    .select("id, name, username")
    .eq("id", beneficiaryId)
    .single<BeneficiaryRow>()

  if (!beneficiary) {
    return { ok: false, error: "Beneficiary not found", status: 404 }
  }

  const user = subscription.users
  if (user?.email) {
    try {
      const fullName =
        user.first_name || user.last_name
          ? `${user.first_name || ""} ${user.last_name || ""}`.trim()
          : null
      await sendBlindSponsorshipMatchedEmail(
        user.email,
        beneficiary.name || "a child",
        subscription.amount || 0,
        subscription.interval || "month",
        fullName,
        beneficiary.username,
        beneficiaryId,
      )
    } catch (emailError) {
      console.error("Error sending match notification email:", emailError)
    }
  }

  return {
    ok: true,
    subscription: updatedSubscription as Record<string, unknown>,
    beneficiary,
  }
}

/**
 * Pick the best beneficiary for a blind sponsorship.
 * Priority: status="New" (no active subs), highest sort_weight, oldest first,
 * still under-funded. CHILD/null types only — open-sponsorship types are excluded.
 */
async function findBestBeneficiaryMatch(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data: beneficiaries, error } = await supabase
    .from("beneficiaries")
    .select("id, name, status, budget_goal, budget_raised, sort_weight, beneficiary_type")
    .or("beneficiary_type.eq.CHILD,beneficiary_type.is.null")
    .eq("status", "New")
    .is("goal_fulfilled_at", null)
    .eq("active_subscriptions", 0)
    .order("sort_weight", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(10)

  if (error) {
    console.error("Error finding beneficiary match:", error)
    return null
  }

  if (!beneficiaries || beneficiaries.length === 0) return null

  for (const beneficiary of beneficiaries) {
    const remaining = (beneficiary.budget_goal || 0) - (beneficiary.budget_raised || 0)
    if (remaining > 0) return beneficiary.id
  }

  return null
}
