import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/utils/supabase/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("id");

  if (!sessionId) {
    return NextResponse.json(
      { error: "Session ID is required" },
      { status: 400 }
    );
  }

  try {
    const supabase = await createClient();
    let session = null;
    let sessionStatus = null;
    let errorDetails = null;

    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["customer_details", "payment_intent"],
      });

      sessionStatus = session.status;
      return NextResponse.json({
        session,
        status: sessionStatus,
      });
    } catch (stripeError) {
      errorDetails =
        stripeError instanceof Error
          ? stripeError.message
          : "Unknown Stripe error";
    }

    const { data: transaction } = await supabase
      .from("transaction_ledger")
      .select("*, beneficiaries(name, location_str)")
      .eq("reference", sessionId)
      .single();

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
      });
    }

    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("*, beneficiaries!inner(name, location_str)")
      .eq("sponsorship_id", sessionId)
      .single();

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
      });
    }
    const { data: partialSubscriptions } = await supabase
      .from("subscriptions")
      .select("*, beneficiaries!inner(name, location_str)")
      .ilike("sponsorship_id", `%${sessionId}%`)
      .limit(1);

    if (partialSubscriptions && partialSubscriptions.length > 0) {
      return NextResponse.json({
        session: {
          id: sessionId,
          status: partialSubscriptions[0].status,
          metadata: {
            childName: partialSubscriptions[0].beneficiaries?.name || "",
            childLocation:
              partialSubscriptions[0].beneficiaries?.location_str || "",
          },
          customer_details: {
            email: "",
          },
        },
        status: partialSubscriptions[0].status,
      });
    }

    // If we can't find any records, return a clear error with details
    return NextResponse.json(
      {
        error: "Payment session not found",
        code: "SESSION_NOT_FOUND",
        details: errorDetails,
        checkedStripe: true,
        checkedDatabase: true,
      },
      { status: 404 }
    );
  } catch (error) {
    console.error("Error checking session status:", error);
    return NextResponse.json(
      {
        error: "An unexpected error occurred",
        code: "UNKNOWN_ERROR",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
