import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/utils/supabase/server";
import { centsToDollars } from "@/utils/currency";
import { sendSponsorshipConfirmationEmail, sendPaymentFailedEmail } from "@/utils/email";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY! as string);

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const sig = req.headers.get("stripe-signature") as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("STRIPE_WEBHOOK_SECRET is not defined.");
      return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
    }

    let event;

    try {
      const rawBody = await req.text();
      console.log('Raw webhook body:', rawBody);
      
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
          const sessionId = (event.data.object as Stripe.Checkout.Session).id;
          const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['line_items']
          });
          console.log('Session data:', session);

          const sponsorshipId = session.metadata?.sponsorshipId;
          const sponsorshipType = session.metadata?.sponsorshipType;
          const amount = parseFloat(session.metadata?.amount || "0");
          const userId = session.metadata?.userId || null;
          const paymentType = session.metadata?.paymentType;
          const customerEmail = session.customer_details?.email;
          const interval = paymentType === "subscription" ? "month" : "year";

          if (!sponsorshipId || !amount || !sponsorshipType) {
            console.error("Missing required metadata in Stripe session:", session.metadata);
            return NextResponse.json({ error: "Invalid metadata" }, { status: 400 });
          }

          // Update sponsorship budget
          const { data: sponsorshipData, error: sponsorshipError } = await supabase
            .from("sponsorships")
            .select(`
              budget_raised, 
              budget_goal,
              child_details(*),
              street_involved_details(*),
              child_labor_details(*),
              family_details(*),
              puppy_details(*)
            `)
            .eq("id", sponsorshipId)
            .single();

          if (sponsorshipError || !sponsorshipData) {
            console.error("Error fetching sponsorship data:", sponsorshipError);
            return NextResponse.json({ error: "Failed to fetch sponsorship data" }, { status: 500 });
          }

          // Update budget_raised only for one-time payments to avoid double counting
          let updateError = null;
          if (paymentType !== "subscription") {
            const updateResult = await supabase
              .from("sponsorships")
              .update({
                budget_raised: sponsorshipData.budget_raised + amount
              })
              .eq("id", sponsorshipId);
            updateError = updateResult.error;
          }

          if (updateError) {
            console.error("Error updating budget:", updateError);
            return NextResponse.json({ error: "Failed to update budget" }, { status: 500 });
          }

          console.log('Processing checkout.session.completed:', {
            mode: session.mode,
            payment_intent: session.payment_intent,
            setup_intent: session.setup_intent,
            payment_status: session.payment_status,
            subscription: session.subscription,
            metadata: session.metadata
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
            }
          } catch (error) {
            console.error('Error retrieving payment details:', error);
          }

          // Create subscription record for both one-time and recurring payments
          const { error: subscriptionError } = await supabase.from("subscriptions").insert({
            stripe_subscription_id: session.subscription || null,
            user_id: userId,
            sponsorship_id: sponsorshipId,
            status: session.payment_status === "paid" ? "complete" : "incomplete",
            amount: amount,
            interval: interval,
            current_period_start: new Date(),
            current_period_end: new Date(Date.now() + (interval === "month" ? 30 : 365) * 24 * 60 * 60 * 1000),
            customer_id: session.customer as string,
            stripe_price_id: session.line_items?.data[0]?.price?.id,
            sponsorship_type: sponsorshipType,
            currency: "usd"
          });

          if (subscriptionError) {
            console.error("Error creating subscription:", subscriptionError);
            return NextResponse.json({ error: "Failed to create subscription" }, { status: 500 });
          }

          // Create transaction record for both one-time and recurring payments
          console.log('DEBUG sponsorshipData:', JSON.stringify(sponsorshipData, null, 2));
          // Prefer metadata.name from Stripe session if available, otherwise fallback to DB
          const sponsorshipName =
            session.metadata?.name ||
            sponsorshipData.child_details?.[0]?.name ||
            sponsorshipData.street_involved_details?.[0]?.name ||
            sponsorshipData.child_labor_details?.[0]?.name ||
            sponsorshipData.family_details?.[0]?.family_name ||
            sponsorshipData.puppy_details?.[0]?.name ||
            "your sponsored beneficiary";

          const { error: transactionError } = await supabase
            .from("transaction_ledger")
            .insert({
              sponsorship_id: sponsorshipId,
              user_id: userId,
              description: `${paymentType === "subscription" ? "Monthly" : "One-time"} sponsorship to ${sponsorshipName} with amount of ${amount}`,
              reference: session.invoice as string,
              credit: amount,
              tx_action: "SPONSORSHIP",
              customer_name: session.customer_details?.name || null,
              customer_email: customerEmail || null,
              sponsorship_type: sponsorshipType,
              stripe_payment_intent: paymentIntentId,
              payment_method_type: paymentMethodType,
              currency: "usd"
            });

          if (transactionError) {
            console.error("Error creating transaction:", transactionError);
            return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
          }

          const { error: activityError } = await supabase
            .from("sponsorship_activities")
            .insert({
              description: `Someone sponsored with $${centsToDollars(amount)}/${interval}`,
              sponsorship_id: sponsorshipId,
              user_id: userId
            });

          if (activityError) {
            console.error("Error creating activity:", activityError);
          }

          if (customerEmail) {
            try {
              if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
                console.warn("Email configuration missing - skipping email send");
              } else {
                const emailResult = await sendSponsorshipConfirmationEmail(
                  customerEmail,
                  sponsorshipName,
                  amount,
                  interval
                );

                try {
                  await supabase.from("email_logs").insert({
                    user_id: userId,
                    email: customerEmail,
                    subject: `Thank you for sponsoring ${sponsorshipName}!`,
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
            .select(`sponsorship_id, sponsorship_type`)
            .eq("stripe_subscription_id", subscriptionId)
            .single();
            
          let sponsorshipName = "your sponsored beneficiary";
          if (subscriptionData?.sponsorship_id) {
            const { data: sponsorship } = await supabase
              .from("sponsorships")
              .select(`
                child_details(*),
                street_involved_details(*),
                child_labor_details(*),
                family_details(*),
                puppy_details(*)
              `)
              .eq("id", subscriptionData.sponsorship_id)
              .single();

            if (sponsorship) {
              sponsorshipName =
                sponsorship.child_details?.[0]?.name ||
                sponsorship.street_involved_details?.[0]?.name ||
                sponsorship.child_labor_details?.[0]?.name ||
                sponsorship.family_details?.[0]?.name ||
                sponsorship.puppy_details?.[0]?.name ||
                "your sponsored beneficiary";
            }
          }

          if (customerEmail) {
            try {
              await sendPaymentFailedEmail(
                customerEmail,
                sponsorshipName,
                invoice.amount_due / 100,
                invoice.next_payment_attempt 
                  ? new Date(invoice.next_payment_attempt * 1000) 
                  : null
              );

              try {
                await supabase.from("email_logs").insert({
                  email: customerEmail,
                  subject: `Payment failed for ${sponsorshipName} sponsorship`,
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
            // Get subscription data from metadata if it exists
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            const metadata = subscription.metadata;
            
            if (!metadata?.sponsorshipId) {
              console.log('No sponsorship metadata found on subscription, skipping processing');
              return NextResponse.json({ message: "Skipped - no metadata" }, { status: 200 });
            }

            const { data: sponsorshipData, error: sponsorshipError } = await supabase
              .from("sponsorships")
              .select(`
                budget_raised,
                child_details(*),
                street_involved_details(*),
                child_labor_details(*),
                family_details(*),
                puppy_details(*)
              `)
              .eq("id", metadata.sponsorshipId)
              .single();

            if (sponsorshipError) {
              console.error("Error fetching sponsorship data:", sponsorshipError);
              throw sponsorshipError;
            }

            // Update budget_raised for recurring payments
            const { error: updateError } = await supabase
              .from("sponsorships")
              .update({
                budget_raised: sponsorshipData.budget_raised + invoice.amount_paid
              })
              .eq("id", metadata.sponsorshipId);

            if (updateError) {
              console.error("Error updating budget:", updateError);
              throw updateError;
            }

            // Prefer metadata.name from Stripe subscription if available, otherwise fallback to DB
            const sponsorshipName =
              metadata?.name ||
              sponsorshipData.child_details?.[0]?.name ||
              sponsorshipData.street_involved_details?.[0]?.name ||
              sponsorshipData.child_labor_details?.[0]?.name ||
              sponsorshipData.family_details?.[0]?.family_name ||
              sponsorshipData.puppy_details?.[0]?.name ||
              "your sponsored beneficiary";

            if (paymentIntentId) {
              const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
              const paymentMethodId = paymentIntent.payment_method as string;
              
              if (paymentMethodId) {
                const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

                await supabase.from("transaction_ledger").insert({
                  sponsorship_id: metadata.sponsorshipId,
                  user_id: metadata.userId || null,
                  description: `Sponsorship payment for ${sponsorshipName}`,
                  credit: invoice.amount_paid,
                  reference: invoice.number,
                  tx_action: "SPONSORSHIP",
                  customer_email: invoice.customer_email,
                  customer_name: invoice.customer_name,
                  sponsorship_type: metadata.sponsorshipType,
                  stripe_payment_intent: paymentIntentId,
                  payment_method_type: paymentMethod.type,
                  currency: invoice.currency
                });
              }
            }

            // Send confirmation email for successful recurring payment
            if (invoice.customer_email) {
              try {
                if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
                  console.warn("Email configuration missing - skipping email send");
                } else {
                  const emailResult = await sendSponsorshipConfirmationEmail(
                    invoice.customer_email,
                    sponsorshipName,
                    invoice.amount_paid,
                    "month"
                  );

                  try {
                    await supabase.from("email_logs").insert({
                      user_id: metadata.userId || null,
                      email: invoice.customer_email,
                      subject: `Thank you for sponsoring ${sponsorshipName}!`,
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

            // Update subscription status
            const { error: subscriptionUpdateError } = await supabase
              .from("subscriptions")
              .update({ status: "complete" })
              .eq("stripe_subscription_id", subscriptionId);

            if (subscriptionUpdateError) {
              console.error("Error updating subscription status:", subscriptionUpdateError);
            }
          } catch (error) {
            console.error("Error processing invoice payment:", error);
            return NextResponse.json({ error: "Failed to process invoice payment" }, { status: 500 });
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
  } catch (error) {
    console.error("Outer webhook error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error occurred' }, { status: 500 });
  }
}
