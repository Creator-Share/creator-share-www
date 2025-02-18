import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/utils/supabase/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function POST(req: Request) {
  try {
    const { subscriptionId } = await req.json();
    const supabase = await createClient();

    // Cancel the subscription in Stripe
    await stripe.subscriptions.cancel(subscriptionId);

    // Update the subscription status in your database
    const { error } = await supabase
      .from("subscriptions")
      .update({ 
        status: "cancelled",
        canceled_at: new Date().toISOString()
      })
      .eq("stripe_subscription_id", subscriptionId);

    if (error) throw error;

    return NextResponse.json({ message: "Subscription cancelled successfully" });
  } catch (error) {
    console.error("Error cancelling subscription:", error);
    return NextResponse.json(
      { error: "Failed to cancel subscription" },
      { status: 500 }
    );
  }
} 