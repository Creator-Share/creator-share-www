import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/utils/supabase/client";
import { centsToDollars } from "@/utils/currency";
import { sendSponsorshipConfirmationEmail, sendPaymentFailedEmail } from "@/utils/email";

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
    
    console.log(`Webhook verified: ${event.type}`);
  } catch (err) {
    console.error("Error verifying Stripe webhook:", err);
    return NextResponse.json({ error: "Webhook verification failed" }, { status: 400 });
  }

  try {
    console.log(`Processing event: ${event.type}`);
    
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        
        // Extract metadata
        const beneficiaryId = session.metadata?.beneficiaryId;
        const amount = parseFloat(session.metadata?.amount || "0");
        const userId = session.metadata?.userId || null;
        const paymentType = session.metadata?.paymentType;
        const customerEmail = session.customer_details?.email;
        const interval = paymentType === "subscription" ? "month" : "year";
        
        // Validate required metadata
        if (!beneficiaryId || !amount) {
          console.error("Missing required metadata in Stripe session:", session.metadata);
          return NextResponse.json({ error: "Invalid metadata" }, { status: 400 });
        }

        // Fetch child data
        const { data: beneficiaryData, error: beneficiaryError } = await supabase
          .from("beneficiaries")
          .select("name, budget_raised, budget_goal")
          .eq("id", beneficiaryId)
          .single();

        if (beneficiaryError || !beneficiaryData) {
          console.error("Error fetching beneficiary data:", beneficiaryError);
          return NextResponse.json({ error: "Failed to fetch beneficiary data" }, { status: 500 });
        }

        // Create transaction record
        const { error: transactionError } = await supabase
          .from("transaction_ledger")
          .insert({
            beneficiary_id: beneficiaryId,
            user_id: userId,
            description: `Sponsorship to ${beneficiaryData.name} with amount of ${amount}`,
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

        // Create activity record
        const { error: activityError } = await supabase
          .from("activities")
          .insert({
            description: `Someone sponsored with $${centsToDollars(amount)}/${interval}`,
            beneficiary_id: beneficiaryId,
            user_id: userId
          });

        if (activityError) {
          console.error("Error creating activity:", activityError);
          // Continue processing even if activity creation fails
        }

        // For subscription mode, we'll handle subscription creation in the subscription.created event
        if (session.mode === 'subscription') {
          console.log('Subscription will be handled by subscription.created event');
        } else {
          // For one-time payments, create subscription record now
          const { error: subscriptionError } = await supabase.from("subscriptions").insert({
            stripe_subscription_id: session.subscription as string,
            user_id: userId,
            beneficiary_id: beneficiaryId,
            status: "complete",
            amount: amount,
            interval: interval,
            current_period_start: new Date(),
            current_period_end: new Date(Date.now() + (interval === "month" ? 30 : 365) * 24 * 60 * 60 * 1000),
            customer_id: session.customer as string
          });

          if (subscriptionError) {
            console.error("Error creating subscription:", subscriptionError);
            return NextResponse.json({ error: "Failed to create subscription" }, { status: 500 });
          }
        }

        // Send confirmation email if we have customer email
        if (customerEmail) {
          try {
            if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
              console.warn("Email configuration missing - skipping email send");
            } else {
              const emailResult = await sendSponsorshipConfirmationEmail(
                customerEmail,
                beneficiaryData.name,
                amount,
                interval
              );
              
              // Log email attempt
              try {
                await supabase.from("email_logs").insert({
                  user_id: userId,
                  email: customerEmail,
                  subject: `Thank you for sponsoring ${beneficiaryData.name}!`,
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
            // Continue processing even if email sending fails
          }
        }

        return NextResponse.json({ message: "Transaction processed successfully" }, { status: 200 });
      }
      
      case "customer.subscription.created": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log('Subscription created:', subscription.id);
        
        // Create subscription record in database
        const { error: subscriptionError } = await supabase.from("subscriptions").insert({
          stripe_subscription_id: subscription.id,
          user_id: subscription.metadata?.userId,
          beneficiary_id: subscription.metadata?.beneficiaryId,
          status: subscription.status === "active" ? "complete" : "incomplete",
          amount: subscription.items.data[0].price.unit_amount,
          interval: subscription.items.data[0].price.recurring?.interval,
          current_period_start: new Date(subscription.current_period_start * 1000),
          current_period_end: new Date(subscription.current_period_end * 1000),
          customer_id: subscription.customer as string
        });

        if (subscriptionError) {
          console.error("Error creating subscription record:", subscriptionError);
          return NextResponse.json({ error: "Failed to create subscription record" }, { status: 500 });
        }

        return NextResponse.json({ message: "Subscription processed" }, { status: 200 });
      }
      
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerEmail = invoice.customer_email;
        const subscriptionId = invoice.subscription as string;
        
        console.log(`Payment failed for subscription: ${subscriptionId}`);

        // Update subscription status
        const { error: updateError } = await supabase.from("subscriptions")
          .update({ status: "incomplete" })
          .eq("stripe_subscription_id", subscriptionId);
          
        if (updateError) {
          console.error("Error updating subscription status:", updateError);
        }

        // Get child information for email
        const { data: subscriptionData } = await supabase
          .from("subscriptions")
          .select(`beneficiary_id`)
          .eq("stripe_subscription_id", subscriptionId)
          .single();
          
        let beneficiaryName = "your sponsored beneficiary";
        if (subscriptionData?.beneficiary_id) {
          const { data: sponsorship } = await supabase
            .from("beneficiaries")
            .select("name")
            .eq("id", subscriptionData.beneficiary_id)
            .single();
            
          if (sponsorship) {
            beneficiaryName = sponsorship.name;
          }
        }

        // Send payment failed email
        if (customerEmail) {
          try {
            await sendPaymentFailedEmail(
              customerEmail,
              beneficiaryName,
              invoice.amount_due / 100,
              invoice.next_payment_attempt 
                ? new Date(invoice.next_payment_attempt * 1000) 
                : null
            );
            
            // Log email attempt
            try {
              await supabase.from("email_logs").insert({
                email: customerEmail,
                subject: `Payment failed for ${beneficiaryName} sponsorship`,
                status: 'sent',
                created_at: new Date()
              });
            } catch (err) {
              console.error("Error logging email attempt:", err);
            }
          } catch (emailError) {
            console.error("Error sending payment failed email:", emailError);
          }
        }
        
        return NextResponse.json({ message: "Payment failure handled" }, { status: 200 });
      }
      
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;

        // Update subscription record
        const { error: updateError } = await supabase.from("subscriptions")
          .update({ 
            status: subscription.status === "active" ? "complete" : "incomplete",
            current_period_start: new Date(subscription.current_period_start * 1000),
            current_period_end: new Date(subscription.current_period_end * 1000)
          })
          .eq("stripe_subscription_id", subscription.id);
          
        if (updateError) {
          console.error("Error updating subscription:", updateError);
          return NextResponse.json({ error: "Failed to update subscription" }, { status: 500 });
        }
        
        return NextResponse.json({ message: "Subscription updated" }, { status: 200 });
      }
      
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;

        // Mark subscription as cancelled
        const { error: updateError } = await supabase.from("subscriptions")
          .update({ 
            status: "cancelled",
            canceled_at: new Date()
          })
          .eq("stripe_subscription_id", subscription.id);
          
        if (updateError) {
          console.error("Error cancelling subscription:", updateError);
          return NextResponse.json({ error: "Failed to cancel subscription" }, { status: 500 });
        }
        
        return NextResponse.json({ message: "Subscription cancelled" }, { status: 200 });
      }
      
      case "invoice.paid":
      case "invoice.payment_succeeded":
        // These events indicate successful payment of an invoice
        // We can use them to update our database if needed
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string;
        
        if (subscriptionId) {
          await supabase.from("subscriptions")
            .update({ status: "complete" })
            .eq("stripe_subscription_id", subscriptionId);
        }
        
        return NextResponse.json({ message: "Invoice payment processed" }, { status: 200 });
        
      case "payment_intent.succeeded":
        // Payment intent succeeded, which means a payment was successful
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        
        // Log the successful payment intent for reference
        console.log(`Payment intent succeeded: ${paymentIntent.id}`);
        
        return NextResponse.json({ message: "Payment intent succeeded" }, { status: 200 });
        
      default:
        // For all other event types, just acknowledge receipt
        console.log(`Unhandled event type: ${event.type}`);
        return NextResponse.json({ message: `Received ${event.type} event` }, { status: 200 });
    }
  } catch (error) {
    console.error("Detailed webhook error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error occurred' }, { status: 500 });
  }
}
