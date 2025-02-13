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
    const userId = session.metadata?.userId || null;
    
    if (!childId || !amount) {
      console.error("Missing metadata in Stripe session");
      return NextResponse.json({ error: "Invalid metadata" }, { status: 400 });
    }

    const { data: childData, error: childError } = await supabase
      .from("sponsor_people")
      .select("name, budget_raised, budget_goal")
      .eq("id", childId)
      .single();

    if (childError || !childData) {
      console.error("Error fetching child data:", childError);
      return NextResponse.json({ error: "Failed to fetch child data" }, { status: 500 });
    }

    const { error: transactionError } = await supabase
      .from("transaction_ledger")
      .insert({
        child_id: childId,
        user_id: userId,
        description: `Sponsorship to ${childData.name} with amount of ${amount}`,
        reference: session.invoice as string,
        credit: amount,
        subscription_type: session.mode === "subscription" ? "subscription" : "payment",
        tx_action: "SPONSORSHIP",
        customer_name: session.customer_details?.name || null,
        customer_email: session.customer_details?.email || null
      });

    if (transactionError) {
      console.error("Error creating transaction:", transactionError);
      return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
    }

    const updatedBudget = childData.budget_raised + amount;
    let status = "Partially Funded";

    if (updatedBudget >= childData.budget_goal) {
      status = "Budget Fulfilled";
    }

    const { error: updateError } = await supabase
      .from("sponsor_people")
      .update({ 
        budget_raised: updatedBudget,
        status: status 
      })
      .eq("id", childId);

    if (updateError) {
      console.error("Error updating child data:", updateError);
      return NextResponse.json({ error: "Failed to update child data" }, { status: 500 });
    }

    return NextResponse.json({ message: "Transaction processed successfully" }, { status: 200 });
  }

  if (event.type === "customer.subscription.created") {
    const subscription = event.data.object as Stripe.Subscription;
    console.log('Subscription created:', subscription);
    
    await supabase.from("subscriptions").insert({
      stripe_subscription_id: subscription.id,
      user_id: subscription.metadata?.userId,
      child_id: subscription.metadata?.childId,
      status: subscription.status,
      amount: subscription.items.data[0].price.unit_amount,
      interval: subscription.items.data[0].price.recurring?.interval,
      current_period_start: new Date(subscription.current_period_start * 1000),
      current_period_end: new Date(subscription.current_period_end * 1000)
    });

    return NextResponse.json({ message: "Subscription processed" }, { status: 200 });
  }

  if (event.type === "invoice.payment_succeeded" || 
      event.type === "checkout.session.completed" as Stripe.WebhookEndpointCreateParams.EnabledEvent) {

    const session = event.data.object as Stripe.Checkout.Session;
    const childId = session.metadata?.childId;
    const amount = parseFloat(session.metadata?.amount || "0");
    const userId = session.metadata?.userId || null;

    if (!childId || !amount) {
      console.error("Missing metadata in Stripe session");
      return NextResponse.json({ error: "Invalid metadata" }, { status: 400 });
    }

    const { error: transactionError } = await supabase
      .from("transaction_ledger")
      .insert({
        child_id: childId,
        user_id: userId,
        description: `Payment received for child ID: ${childId}`,
        reference: session.id,
        credit: amount,
        subscription_type: session.mode === "subscription" ? "subscription" : "payment",
        tx_action: "SPONSORSHIP",
        customer_name: session.customer_details?.name || null,
        customer_email: session.customer_details?.email || null
      });

    if (transactionError) {
      console.error("Error creating transaction:", transactionError);
      return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    
    await supabase
      .from("subscriptions")
      .update({ 
        status: "cancelled",
        canceled_at: new Date()
      })
      .eq("stripe_subscription_id", subscription.id);
  }

  return NextResponse.json({ message: "Unhandled event type" }, { status: 400 });
}
