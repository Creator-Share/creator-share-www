import { NextResponse } from "next/server"
import { coerceRegion, getStripeClient } from "@/lib/stripe/config"
import { createClient } from "@/utils/supabase/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get("id")
  const region = coerceRegion(searchParams.get("region"))

  if (!sessionId) {
    return NextResponse.json(
      { error: "Session ID is required" },
      { status: 400 },
    )
  }

  const stripe = getStripeClient(region)

  try {
    const supabase = await createClient()
    let stripeErrorDetails: string | null = null

    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["customer_details", "payment_intent"],
      })

      return NextResponse.json({
        session,
        status: session.status,
      })
    } catch (stripeError) {
      stripeErrorDetails =
        stripeError instanceof Error
          ? stripeError.message
          : "Unknown Stripe error"
    }

    // Stripe lookup failed (test/live mismatch, deleted session, etc.).
    // Fall back to our own ledger + subscriptions store. Subscriptions are
    // identified by stripe_subscription_id; the legacy code path queried a
    // dropped `sponsorship_id` column and silently returned "not found".
    const { data: transaction, error: transactionError } = await supabase
      .from("transaction_ledger")
      .select("*, beneficiaries(name, location_str)")
      .eq("reference", sessionId)
      .maybeSingle()

    if (transactionError) {
      console.error(
        "[stripe/session] transaction_ledger lookup failed:",
        transactionError,
      )
    }

    if (transaction) {
      return NextResponse.json({
        session: {
          id: sessionId,
          status: "complete",
          metadata: {
            childName: transaction.beneficiaries?.name || "",
            childLocation: transaction.beneficiaries?.location_str || "",
          },
          customer_details: {
            email: transaction.customer_email,
          },
        },
        status: "completed",
      })
    }

    const { data: subscription, error: subscriptionError } = await supabase
      .from("subscriptions")
      .select("*, beneficiaries!inner(name, location_str)")
      .eq("stripe_subscription_id", sessionId)
      .maybeSingle()

    if (subscriptionError) {
      console.error(
        "[stripe/session] subscriptions lookup failed:",
        subscriptionError,
      )
    }

    if (subscription) {
      return NextResponse.json({
        session: {
          id: sessionId,
          status: subscription.status,
          metadata: {
            childName: subscription.beneficiaries?.name || "",
            childLocation: subscription.beneficiaries?.location_str || "",
          },
          customer_details: {
            email: "",
          },
        },
        status: subscription.status,
      })
    }

    return NextResponse.json(
      {
        error: "Payment session not found",
        code: "SESSION_NOT_FOUND",
        details: stripeErrorDetails,
        checkedStripe: true,
        checkedDatabase: true,
      },
      { status: 404 },
    )
  } catch (error) {
    console.error("Error checking session status:", error)
    return NextResponse.json(
      {
        error: "An unexpected error occurred",
        code: "UNKNOWN_ERROR",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
