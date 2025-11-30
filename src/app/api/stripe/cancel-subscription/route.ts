import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@/utils/supabase/server"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string)

export async function POST(req: Request) {
  try {
    const { subscriptionId } = await req.json()

    if (!subscriptionId) {
      return NextResponse.json(
        { error: "Subscription ID is required" },
        { status: 400 },
      )
    }

    const supabase = await createClient()

    // First check if the subscription exists in our database
    // Try to find by sponsorship_id first, then by database id
    let subscription
    let fetchError

    const { data: subscriptionByStripeId, error: stripeIdError } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("sponsorship_id", subscriptionId)
      .single()

    if (subscriptionByStripeId && !stripeIdError) {
      subscription = subscriptionByStripeId
      fetchError = stripeIdError
    } else {
      // If not found by sponsorship_id, try by database id
      const { data: subscriptionById, error: idError } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("id", subscriptionId)
        .single()
      
      subscription = subscriptionById
      fetchError = idError
    }

    if (fetchError || !subscription) {
      return NextResponse.json(
        {
          error: "Subscription not found in database",
          details: fetchError?.message || "No subscription found with provided ID"
        },
        { status: 404 },
      )
    }

    // If subscription is already cancelled, just return success
    if (subscription.status === "cancelled") {
      return NextResponse.json({
        message: "Subscription was already cancelled",
        alreadyCancelled: true,
      })
    }

    try {
      // Cancel the subscription in Stripe only if we have a valid Stripe subscription ID
      if (subscription.sponsorship_id) {
        await stripe.subscriptions.cancel(subscription.sponsorship_id)
      }

      // Get subscription data before updating
      const beneficiaryId = subscription.beneficiary_id
      const amount = subscription.amount

      // Update our database record
      const { error } = await supabase
        .from("subscriptions")
        .update({
          status: "cancelled",
          canceled_at: new Date().toISOString(),
        })
        .eq("id", subscription.id)

      if (error) {
        console.error("Database error when cancelling subscription:", error)
        return NextResponse.json(
          {
            error: "Failed to update subscription in database",
            details: error.message,
          },
          { status: 500 },
        )
      }

      // Check if beneficiary has any active subscriptions and update status if needed
      if (beneficiaryId) {
        const { data: activeSubscriptions, error: activeError } = await supabase
          .from("subscriptions")
          .select("id")
          .eq("beneficiary_id", beneficiaryId)
          .eq("status", "complete")

        if (!activeError && (!activeSubscriptions || activeSubscriptions.length === 0)) {
          // No active subscriptions - check current status and update if needed
          const { data: beneficiary, error: beneficiaryError } = await supabase
            .from("beneficiaries")
            .select("id, name, status")
            .eq("id", beneficiaryId)
            .single()

          if (!beneficiaryError && beneficiary) {
            // Only update to "Sponsorship Cancelled" if not already Draft or Archived
            if (beneficiary.status !== "Draft" && beneficiary.status !== "Archived") {
              const { error: statusUpdateError } = await supabase
                .from("beneficiaries")
                .update({ status: "Sponsorship Cancelled" })
                .eq("id", beneficiaryId)

              if (statusUpdateError) {
                console.error("Error updating beneficiary status:", statusUpdateError)
              } else {
                // Send email notification
                try {
                  // Get user email if available
                  let customerEmail: string | null = null
                  let customerName: string | null = null
                  if (subscription.user_id) {
                    const { data: user } = await supabase
                      .from("users")
                      .select("email, name")
                      .eq("id", subscription.user_id)
                      .single()
                    if (user) {
                      customerEmail = user.email
                      customerName = user.name
                    }
                  }
                  const { sendSponsorshipCancellationNotificationEmail } = await import("@/utils/email")
                  await sendSponsorshipCancellationNotificationEmail(
                    beneficiary.name,
                    customerEmail,
                    customerName,
                    amount
                  )
                } catch (emailError) {
                  console.error("Error sending cancellation notification email:", emailError)
                }
              }
            }
          }
        }
      }

      return NextResponse.json({
        message: "Subscription cancelled successfully",
      })
    } catch (stripeError) {
      console.error("Stripe error when cancelling subscription:", stripeError)

      // If Stripe cancellation fails but it's because the subscription doesn't exist there,
      // we should still update our database
      if (stripeError instanceof Stripe.errors.StripeInvalidRequestError) {
        // Get subscription data before updating
        const beneficiaryId = subscription.beneficiary_id
        const amount = subscription.amount

        // Update our database to show cancelled anyway
        const { error } = await supabase
          .from("subscriptions")
          .update({
            status: "cancelled",
            canceled_at: new Date().toISOString(),
          })
          .eq("id", subscription.id)

        if (error) {
          console.error("Database error when cancelling subscription:", error)
        }

        // Check if beneficiary has any active subscriptions and update status if needed
        if (beneficiaryId) {
          const { data: activeSubscriptions, error: activeError } = await supabase
            .from("subscriptions")
            .select("id")
            .eq("beneficiary_id", beneficiaryId)
            .eq("status", "complete")

          if (!activeError && (!activeSubscriptions || activeSubscriptions.length === 0)) {
            // No active subscriptions - check current status and update if needed
            const { data: beneficiary, error: beneficiaryError } = await supabase
              .from("beneficiaries")
              .select("id, name, status")
              .eq("id", beneficiaryId)
              .single()

            if (!beneficiaryError && beneficiary) {
              // Only update to "Sponsorship Cancelled" if not already Draft or Archived
              if (beneficiary.status !== "Draft" && beneficiary.status !== "Archived") {
                const { error: statusUpdateError } = await supabase
                  .from("beneficiaries")
                  .update({ status: "Sponsorship Cancelled" })
                  .eq("id", beneficiaryId)

                if (statusUpdateError) {
                  console.error("Error updating beneficiary status:", statusUpdateError)
                } else {
                  // Send email notification
                  try {
                    // Get user email if available
                    let customerEmail: string | null = null
                    let customerName: string | null = null
                    if (subscription.user_id) {
                      const { data: user } = await supabase
                        .from("users")
                        .select("email, name")
                        .eq("id", subscription.user_id)
                        .single()
                      if (user) {
                        customerEmail = user.email
                        customerName = user.name
                      }
                    }
                    const { sendSponsorshipCancellationNotificationEmail } = await import("@/utils/email")
                    await sendSponsorshipCancellationNotificationEmail(
                      beneficiary.name,
                      customerEmail,
                      customerName,
                      amount
                    )
                  } catch (emailError) {
                    console.error("Error sending cancellation notification email:", emailError)
                  }
                }
              }
            }
          }
        }

        return NextResponse.json({
          message: "Subscription marked as cancelled in database",
          warning: "Subscription not found in Stripe",
        })
      }

      return NextResponse.json(
        {
          error: "Failed to cancel subscription with Stripe",
          details:
            stripeError instanceof Error
              ? stripeError.message
              : "Unknown error",
        },
        { status: 500 },
      )
    }
  } catch (error) {
    console.error("Error cancelling subscription:", error)
    return NextResponse.json(
      {
        error: "Failed to process cancellation request",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
