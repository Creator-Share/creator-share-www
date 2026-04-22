import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { sendBlindSponsorshipMatchedEmail } from "@/utils/email"
import { WAITING_STATUSES } from "@/config/beneficiaryStatuses"
import { isOpenSponsorshipType } from "@/config/beneficiaryTypes"

export const runtime = "nodejs"

/**
 * API endpoint for users to self-assign their blind sponsorships to a beneficiary
 * 
 * POST body:
 * - subscriptionId: The blind sponsorship subscription ID
 * - beneficiaryId: The beneficiary ID to assign to
 */
export async function POST(req: Request) {
  const supabase = await createClient()

  try {
    // Get the current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      )
    }

    const { subscriptionId, beneficiaryId } = await req.json()

    if (!subscriptionId || !beneficiaryId) {
      return NextResponse.json(
        { error: "Missing required parameters: subscriptionId and beneficiaryId" },
        { status: 400 },
      )
    }

    // Verify the subscription belongs to the user and is a blind sponsorship
    const { data: subscription, error: subError } = await supabase
      .from("subscriptions")
      .select("*, users(email, first_name, last_name)")
      .eq("id", subscriptionId)
      .eq("user_id", user.id)
      .is("beneficiary_id", null)
      .eq("status", "complete")
      .single()

    if (subError || !subscription) {
      return NextResponse.json(
        { error: "Blind sponsorship not found or already assigned" },
        { status: 404 },
      )
    }

    // Verify the beneficiary exists and is available
    const { data: beneficiary, error: benError } = await supabase
      .from("beneficiaries")
      .select("id, name, username, status, budget_goal, budget_raised, beneficiary_type")
      .eq("id", beneficiaryId)
      .or(`and(status.in.(${WAITING_STATUSES.map(s => `"${s}"`).join(",")}),goal_fulfilled_at.is.null),and(budget_goal.eq.-1,status.not.in.(Draft,Archived))`)
      .single()

    if (benError || !beneficiary) {
      return NextResponse.json(
        { error: "Beneficiary not found or not available for sponsorship" },
        { status: 404 },
      )
    }

    // Check if beneficiary still needs funding
    // Open sponsorship types (budget_goal = -1) are always available
    if (!isOpenSponsorshipType(beneficiary.beneficiary_type)) {
      const remaining = (beneficiary.budget_goal || 0) - (beneficiary.budget_raised || 0)
      if (remaining <= 0) {
        return NextResponse.json(
          { error: "This beneficiary is already fully funded" },
          { status: 400 },
        )
      }
    }

    // Update the subscription with the beneficiary
    const { data: updatedSubscription, error: updateError } = await supabase
      .from("subscriptions")
      .update({ beneficiary_id: beneficiaryId })
      .eq("id", subscriptionId)
      .select()
      .single()

    if (updateError) {
      console.error("Error updating subscription:", updateError)
      return NextResponse.json(
        { error: "Failed to assign beneficiary to subscription" },
        { status: 500 },
      )
    }

    // Send notification email
    const userRecord = subscription.users as { email?: string; first_name?: string; last_name?: string } | null
    if (userRecord?.email) {
      try {
        await sendBlindSponsorshipMatchedEmail(
          userRecord.email,
          beneficiary.name || "a child",
          subscription.amount || 0,
          subscription.interval || "month",
          userRecord.first_name || userRecord.last_name 
            ? `${userRecord.first_name || ""} ${userRecord.last_name || ""}`.trim() 
            : null,
          beneficiary.username,
          beneficiaryId,
        )
      } catch (emailError) {
        console.error("Error sending assignment notification email:", emailError)
        // Don't fail the request if email fails
      }
    }

    return NextResponse.json({
      success: true,
      subscription: updatedSubscription,
      beneficiary: beneficiary,
    })
  } catch (error) {
    console.error("Error in self-assignment:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
