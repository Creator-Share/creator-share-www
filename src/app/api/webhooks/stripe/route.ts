import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/utils/supabase/client";
import { centsToDollars } from "@/utils/currency";
import { sendSponsorshipConfirmationEmail } from "@/utils/email";

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
    console.log("Received webhook with signature:", sig);
    
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig as string,
      webhookSecret
    );
    
    console.log(`Webhook verified: ${event.type}`);
  } catch (err) {
    console.error("Error verifying Stripe webhook:", err);
    return NextResponse.json({ error: "Webhook verification failed" }, { status: 400 });
  }
  console.log(`Processing event: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("Processing checkout.session.completed:", session.id);
        
        const childId = session.metadata?.childId;
        const amount = parseFloat(session.metadata?.amount || "0");
        const userId = session.metadata?.userId || null;
        const paymentType = session.metadata?.paymentType;
        const customerEmail = session.customer_details?.email;
        
        if (!childId || !amount) {
          console.error("Missing metadata in Stripe session:", session.metadata);
          return NextResponse.json({ error: "Invalid metadata" }, { status: 400 });
        }

        console.log(`Processing sponsorship: ${childId}, ${amount}, ${customerEmail}`);

        const { data: childData, error: childError } = await supabase
          .from("sponsor_people")
          .select("name, budget_raised, budget_goal")
          .eq("id", childId)
          .single();

        if (childError || !childData) {
          console.error("Error fetching child data:", childError);
          return NextResponse.json({ error: "Failed to fetch child data" }, { status: 500 });
        }

        console.log("Child data retrieved:", childData);
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
            customer_email: customerEmail || null
          });

        if (transactionError) {
          console.error("Error creating transaction:", transactionError);
          return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
        }

        const interval = paymentType === "subscription" ? "month" : "year";
        const { error: activityError } = await supabase
          .from("people_activities")
          .insert({
            description: `Someone sponsored with $${centsToDollars(amount)}/${interval}`,
            child_id: childId,
            user_id: userId
          });

        if (activityError) {
          console.error("Error creating activity:", activityError);
        }
        if (session.mode === 'subscription') {
          console.log('Skipping subscription creation for checkout.session.completed - will be handled by subscription event');
        } else {
          const { error: subscriptionError } = await supabase.from("subscriptions").insert({
            stripe_subscription_id: session.subscription as string,
            user_id: userId,
            child_id: childId,
            status: "complete",
            amount: amount,
            interval: paymentType === "subscription" ? "month" : "year",
            current_period_start: new Date(),
            current_period_end: new Date(Date.now() + (paymentType === "subscription" ? 30 : 365) * 24 * 60 * 60 * 1000),
            customer_id: session.customer as string
          });

          if (subscriptionError) {
            console.error("Error creating subscription:", subscriptionError);
            return NextResponse.json({ error: "Failed to create subscription" }, { status: 500 });
          }
        }
        if (customerEmail) {
          try {
            console.log(`Attempting to send email to ${customerEmail}`);
            if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
              console.warn("Email configuration missing - skipping email send");
            } else {
              const emailResult = await sendSponsorshipConfirmationEmail(
                customerEmail,
                childData.name,
                amount,
                interval
              );
              
              console.log("Email sending result:", emailResult);
              try {
                await supabase.from("email_logs").insert({
                  user_id: userId,
                  email: customerEmail,
                  subject: `Thank you for sponsoring ${childData.name}!`,
                  status: emailResult.success ? 'sent' : 'failed',
                  error: emailResult.error ? JSON.stringify(emailResult.error) : null,
                  message_id: emailResult.messageId,
                  created_at: new Date()
                });
              } catch (err) {
                console.error("Error logging email attempt:", err);
              }
            }
          } catch (emailError) {
            console.error("Error in email sending process:", emailError);
          }
        }

        return NextResponse.json({ message: "Transaction processed successfully" }, { status: 200 });
      }
      
      case "customer.subscription.created": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log('Subscription created:', subscription.id);
        
        await supabase.from("subscriptions").insert({
          stripe_subscription_id: subscription.id,
          user_id: subscription.metadata?.userId,
          child_id: subscription.metadata?.childId,
          status: "incomplete",
          amount: subscription.items.data[0].price.unit_amount,
          interval: subscription.items.data[0].price.recurring?.interval,
          current_period_start: new Date(subscription.current_period_start * 1000),
          current_period_end: new Date(subscription.current_period_end * 1000),
          customer_id: subscription.customer as string
        });

        return NextResponse.json({ message: "Subscription processed" }, { status: 200 });
      }
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
        return NextResponse.json({ message: `Received ${event.type} event` }, { status: 200 });
    }
  } catch (error) {
    console.error(`Error processing ${event.type} event:`, error);
    return NextResponse.json({ error: "Error processing webhook" }, { status: 500 });
  }
}
