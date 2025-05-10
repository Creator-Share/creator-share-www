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

        const childId = session.metadata?.childId;
        const amount = parseFloat(session.metadata?.amount || "0");
        const userId = session.metadata?.userId || null;
        const paymentType = session.metadata?.paymentType;
        const customerEmail = session.customer_details?.email;
        const interval = paymentType === "subscription" ? "month" : "year";

        if (!childId || !amount) {
          console.error("Missing required metadata in Stripe session:", session.metadata);
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

        console.log('Processing checkout.session.completed:', {
          mode: session.mode,
          payment_intent: session.payment_intent,
          setup_intent: session.setup_intent,
          payment_status: session.payment_status,
          subscription: session.subscription,
          line_items: session.line_items,
          metadata: session.metadata
        });

        const expandedSession = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['line_items.data.price']
        });
        console.log('Expanded session details:', {
          line_items: expandedSession.line_items?.data
        });

        let paymentMethodId = null;
        let paymentMethodType = null;
        let paymentIntentId = null;

        try {

          if (session.mode === 'subscription' && session.setup_intent) {
            console.log('Retrieving setup intent:', session.setup_intent);
            const setupIntent = await stripe.setupIntents.retrieve(session.setup_intent as string);
            paymentMethodId = setupIntent.payment_method as string;
            
            if (paymentMethodId) {
              const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
              paymentMethodType = paymentMethod.type;
            }
            
            console.log('Setup intent details:', {
              payment_method: paymentMethodId,
              payment_method_type: paymentMethodType
            });
          } 
          else if (session.payment_intent) {
            console.log('Retrieving payment intent:', session.payment_intent);
            paymentIntentId = session.payment_intent as string;
            const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
            paymentMethodId = paymentIntent.payment_method as string;
            
            if (paymentMethodId) {
              const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
              paymentMethodType = paymentMethod.type;
            }
            
            console.log('Payment intent details:', {
              payment_method: paymentMethodId,
              payment_method_type: paymentMethodType
            });
          }
        } catch (error) {
          console.error('Error retrieving payment details:', error);
        }

        console.log('Final payment details:', {
          paymentMethodId,
          paymentMethodType,
          paymentIntentId
        });

        // Only create transaction for one-time payments here
        // Subscription payments are handled in invoice.paid event
        if (session.mode === 'payment') {
          const { error: transactionError } = await supabase
            .from("transaction_ledger")
            .insert({
              child_id: childId,
              user_id: userId,
              description: `One-time sponsorship to ${childData.name} with amount of ${amount}`,
              reference: session.invoice as string,
              credit: amount,
              subscription_type: "Child Sponsorship",
              tx_action: "SPONSORSHIP",
              customer_name: session.customer_details?.name || null,
              customer_email: customerEmail || null,
              sponsorship_type: paymentType || null,
              stripe_payment_intent_id: paymentIntentId,
              stripe_payment_method_id: paymentMethodId,
              payment_method_type: paymentMethodType
            });

          if (transactionError) {
            console.error("Error creating transaction:", transactionError);
            return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
          }
        }

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
          console.log('Subscription will be handled by subscription.created event');
        } else {
          const { error: subscriptionError } = await supabase.from("subscriptions").insert({
            stripe_subscription_id: session.subscription as string,
            user_id: userId,
            child_id: childId,
            status: "complete",
            amount: amount,
            interval: interval,
            current_period_start: new Date(),
            current_period_end: new Date(Date.now() + (interval === "month" ? 30 : 365) * 24 * 60 * 60 * 1000),
            customer_id: session.customer as string,
            stripe_price_id: session.line_items?.data[0]?.price?.id,
            sponsorship_type: paymentType
          });

          if (subscriptionError) {
            console.error("Error creating subscription:", subscriptionError);
            return NextResponse.json({ error: "Failed to create subscription" }, { status: 500 });
          }
        }

        if (customerEmail) {
          try {
            if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
              console.warn("Email configuration missing - skipping email send");
            } else {
              const emailResult = await sendSponsorshipConfirmationEmail(
                customerEmail,
                childData.name,
                amount,
                interval
              );

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

        const { error: subscriptionError } = await supabase.from("subscriptions").insert({
          stripe_subscription_id: subscription.id,
          user_id: subscription.metadata?.userId,
          child_id: subscription.metadata?.childId,
          status: subscription.status === "active" ? "complete" : "incomplete",
          amount: subscription.items.data[0].price.unit_amount,
          interval: subscription.items.data[0].price.recurring?.interval,
          current_period_start: new Date(subscription.current_period_start * 1000),
          current_period_end: new Date(subscription.current_period_end * 1000),
          customer_id: subscription.customer as string,
          stripe_price_id: subscription.items.data[0].price.id,
          sponsorship_type: subscription.metadata?.paymentType
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

        const { error: updateError } = await supabase.from("subscriptions")
          .update({ status: "incomplete" })
          .eq("stripe_subscription_id", subscriptionId);
          
        if (updateError) {
          console.error("Error updating subscription status:", updateError);
        }

        const { data: subscriptionData } = await supabase
          .from("subscriptions")
          .select(`child_id`)
          .eq("stripe_subscription_id", subscriptionId)
          .single();
          
        let childName = "your sponsored child";
        if (subscriptionData?.child_id) {
          const { data: sponsorPeople } = await supabase
            .from("sponsor_people")
            .select("name")
            .eq("id", subscriptionData.child_id)
            .single();
            
          if (sponsorPeople) {
            childName = sponsorPeople.name;
          }
        }

        if (customerEmail) {
          try {
            await sendPaymentFailedEmail(
              customerEmail,
              childName,
              invoice.amount_due / 100,
              invoice.next_payment_attempt 
                ? new Date(invoice.next_payment_attempt * 1000) 
                : null
            );

            try {
              await supabase.from("email_logs").insert({
                email: customerEmail,
                subject: `Payment failed for ${childName} sponsorship`,
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

        const { error: updateError } = await supabase.from("subscriptions")
          .update({ 
            status: subscription.status === "active" ? "complete" : "incomplete",
            current_period_start: new Date(subscription.current_period_start * 1000),
            current_period_end: new Date(subscription.current_period_end * 1000),
            stripe_price_id: subscription.items.data[0].price.id
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
      
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string;
        const paymentIntentId = invoice.payment_intent as string;
        
        try {
          const { data: subscriptionData, error: subscriptionError } = await supabase
            .from("subscriptions")
            .select("child_id, sponsorship_type")
            .eq("stripe_subscription_id", subscriptionId)
            .single();

          if (subscriptionError) {
            console.error("Error fetching subscription data:", subscriptionError);
            throw subscriptionError;
          }

          const { data: childData, error: childError } = await supabase
            .from("sponsor_people")
            .select("name")
            .eq("id", subscriptionData.child_id)
            .single();

          if (childError) {
            console.error("Error fetching child data:", childError);
            throw childError;
          }

          if (paymentIntentId) {
            const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
            const paymentMethodId = paymentIntent.payment_method as string;
            
            if (paymentMethodId) {
              const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

              await supabase.from("transaction_ledger").insert({
                child_id: subscriptionData.child_id,
                description: `Sponsorship payment for ${childData.name}`,
                credit: invoice.amount_paid,
                reference: invoice.number,
                subscription_type: "Child Sponsorship",
                tx_action: "Sponsorship",
                customer_email: invoice.customer_email,
                customer_name: invoice.customer_name,
                sponsorship_type: subscriptionData.sponsorship_type,
                stripe_payment_intent_id: paymentIntentId,
                stripe_payment_method_id: paymentMethodId,
                payment_method_type: paymentMethod.type
              });
            }
          }

          if (subscriptionId) {
            await supabase.from("subscriptions")
              .update({ status: "complete" })
              .eq("stripe_subscription_id", subscriptionId);
          }
        } catch (error) {
          console.error("Error processing invoice payment:", error);
        }
        
        return NextResponse.json({ message: "Invoice payment processed" }, { status: 200 });
      }
        
      case "invoice.payment_succeeded": {
        // Skip processing to avoid duplicate entries since we handle this in invoice.paid
        console.log('Skipping invoice.payment_succeeded to avoid duplicate transaction');
        return NextResponse.json({ message: "Skipped to avoid duplicate" }, { status: 200 });
      }

      case "payment_intent.succeeded":
        const paymentIntent = event.data.object as Stripe.PaymentIntent;

        console.log(`Payment intent succeeded: ${paymentIntent.id}`);
        
        return NextResponse.json({ message: "Payment intent succeeded" }, { status: 200 });
        
      default:

        console.log(`Unhandled event type: ${event.type}`);
        return NextResponse.json({ message: `Received ${event.type} event` }, { status: 200 });
    }
  } catch (error) {
    console.error("Detailed webhook error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error occurred' }, { status: 500 });
  }
}
