import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/utils/supabase/client";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY! as string);

export async function POST(req: Request) {
  const supabase = createClient();
  const sig = req.headers.get("stripe-signature") as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not defined.");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  let event;

  try {
    const rawBody = await req.text();
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig as string,
      webhookSecret
    );
  } catch (err) {
    console.error("Error verifying Stripe webhook:", err);
    return NextResponse.json({ error: "Webhook verification failed" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const childId = session.metadata?.childId;
    const amount = parseFloat(session.metadata?.amount || "0");
    
    if (!childId || !amount) {
      console.error("Missing metadata in Stripe session");
      return NextResponse.json({ error: "Invalid metadata" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("people")
      .select("budget_raised, budget_goal")
      .eq("id", childId)
      .single();

    if (error || !data) {
      console.error("Error fetching child data:", error);
      return NextResponse.json({ error: "Failed to fetch child data" }, { status: 500 });
    }

    const updatedBudget = data.budget_raised + amount;
    let status = "Partially Funded";

    if (updatedBudget >= data.budget_goal) {
      status = "Budget Fulfilled";
    }

    const { error: updateError } = await supabase
      .from("people")
      .update({ 
        budget_raised: updatedBudget,
        status: status 
      })
      .eq("id", childId);

    if (updateError) {
      console.error("Error updating child data:", updateError);
      return NextResponse.json({ error: "Failed to update child data" }, { status: 500 });
    }

    return NextResponse.json({ message: "Child data updated successfully" }, { status: 200 });
  }

  return NextResponse.json({ message: "Unhandled event type" }, { status: 400 });
}
