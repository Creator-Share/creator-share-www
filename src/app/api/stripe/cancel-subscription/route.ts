import { NextResponse } from "next/server"
import Stripe from "stripe"
import {
  cancelPayPalSubscription,
  isPayPalEnabled,
} from "@/lib/paypal/client"
import { coerceRegion, getStripeClient } from "@/lib/stripe/config"
import type { Database } from "@/lib/types/db.types"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/utils/supabase/server"

type Supabase = SupabaseClient<Database>
type SubscriptionRow =
  Database["public"]["Tables"]["subscriptions"]["Row"]

// Route name is historical — this endpoint now cancels both Stripe and PayPal
// subscriptions, dispatched by `sponsorship_method` on the DB row.
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

    const subscription = await findSubscription(supabase, subscriptionId)
    if (!subscription) {
      return NextResponse.json(
        { error: "Subscription not found in database" },
        { status: 404 },
      )
    }

    if (subscription.status === "cancelled") {
      return NextResponse.json({
        message: "Subscription was already cancelled",
        alreadyCancelled: true,
      })
    }

    const providerResult = await cancelWithProvider(subscription)
    if (providerResult.fatal) {
      return NextResponse.json(
        { error: providerResult.error },
        { status: 500 },
      )
    }

    const { error: updateError } = await supabase
      .from("subscriptions")
      .update({
        status: "cancelled",
        canceled_at: new Date().toISOString(),
      })
      .eq("id", subscription.id)

    if (updateError) {
      console.error("Database error when cancelling subscription:", updateError)
      return NextResponse.json(
        {
          error: "Failed to update subscription in database",
          details: updateError.message,
        },
        { status: 500 },
      )
    }

    await maybeMarkBeneficiaryCancelled(supabase, subscription)

    return NextResponse.json({
      message: "Subscription cancelled successfully",
      provider: subscription.sponsorship_method || "STRIPE",
      providerNotFound: providerResult.notFound,
    })
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

async function findSubscription(
  supabase: Supabase,
  id: string,
): Promise<SubscriptionRow | null> {
  const { data: byDbId } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (byDbId) return byDbId

  const { data: byProviderId } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("stripe_subscription_id", id)
    .maybeSingle()
  return byProviderId
}

interface ProviderCancelResult {
  notFound: boolean
  fatal: boolean
  error?: string
}

async function cancelWithProvider(
  subscription: SubscriptionRow,
): Promise<ProviderCancelResult> {
  const providerId = subscription.stripe_subscription_id
  // Treat missing provider subscription id as "already untracked" — nothing to
  // cancel externally, proceed to DB update.
  if (!providerId) {
    return { notFound: true, fatal: false }
  }

  if (subscription.sponsorship_method === "PAYPAL") {
    if (!isPayPalEnabled) {
      return {
        notFound: false,
        fatal: true,
        error: "PayPal is not configured — cannot cancel PayPal subscription",
      }
    }
    const result = await cancelPayPalSubscription(providerId)
    if (result.cancelled || result.alreadyCancelled || result.notFound) {
      return { notFound: result.notFound, fatal: false }
    }
    return {
      notFound: false,
      fatal: true,
      error: result.error || "Failed to cancel PayPal subscription",
    }
  }

  const region = coerceRegion(subscription.payment_region)
  const stripe = getStripeClient(region)
  try {
    await stripe.subscriptions.cancel(providerId)
    return { notFound: false, fatal: false }
  } catch (err) {
    if (err instanceof Stripe.errors.StripeInvalidRequestError) {
      // Subscription not in Stripe (deleted, test-mode drift, etc.) — still
      // reconcile our DB so the user sees the cancel take effect.
      return { notFound: true, fatal: false }
    }
    console.error("Stripe error when cancelling subscription:", err)
    return {
      notFound: false,
      fatal: true,
      error:
        err instanceof Error
          ? err.message
          : "Failed to cancel subscription with Stripe",
    }
  }
}

async function maybeMarkBeneficiaryCancelled(
  supabase: Supabase,
  subscription: SubscriptionRow,
) {
  const beneficiaryId = subscription.beneficiary_id
  if (!beneficiaryId) return

  const { data: activeSubscriptions, error: activeError } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("beneficiary_id", beneficiaryId)
    .eq("status", "complete")

  if (activeError || (activeSubscriptions && activeSubscriptions.length > 0)) {
    return
  }

  const { data: beneficiary, error: beneficiaryError } = await supabase
    .from("beneficiaries")
    .select("id, name, status")
    .eq("id", beneficiaryId)
    .single()

  if (beneficiaryError || !beneficiary) return
  if (beneficiary.status === "Draft" || beneficiary.status === "Archived") {
    return
  }

  // "Sponsorship Cancelled" is part of the runtime enum (see config/
  // beneficiaryStatuses.ts) but not yet in the regenerated db.types Status
  // union, so the typed client rejects the assignment. Same pattern is used
  // by the webhook handler via the untyped service-role client.
  const { error: statusUpdateError } = await supabase
    .from("beneficiaries")
    .update({
      status:
        "Sponsorship Cancelled" as Database["public"]["Tables"]["beneficiaries"]["Update"]["status"],
    })
    .eq("id", beneficiaryId)

  if (statusUpdateError) {
    console.error("Error updating beneficiary status:", statusUpdateError)
    return
  }

  try {
    let customerEmail: string | null = null
    let customerName: string | null = null
    if (subscription.user_id) {
      const { data: user } = await supabase
        .from("users")
        .select("email, first_name, last_name")
        .eq("id", subscription.user_id)
        .single()
      if (user) {
        customerEmail = user.email
        const fullName = [user.first_name, user.last_name]
          .filter(Boolean)
          .join(" ")
          .trim()
        customerName = fullName || null
      }
    }
    const { sendSponsorshipCancellationNotificationEmail } = await import(
      "@/utils/email"
    )
    await sendSponsorshipCancellationNotificationEmail(
      beneficiary.name ?? "Unknown Beneficiary",
      customerEmail,
      customerName,
      subscription.amount,
    )
  } catch (emailError) {
    console.error(
      "Error sending cancellation notification email:",
      emailError,
    )
  }
}
