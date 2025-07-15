import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/utils/supabase/client";
import { centsToDollars } from "@/utils/currency";
import {
  sendSponsorshipConfirmationEmail,
  sendPaymentFailedEmail
} from "@/utils/email";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY! as string);

export async function POST(req: Request) {
  const supabase = createClient();
  const sig = req.headers.get("stripe-signature") as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not defined.");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
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
    return NextResponse.json(
      { error: "Webhook verification failed" },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const type = session.metadata?.type;
        const amount = parseFloat(session.metadata?.amount || "0");
        const paymentType = session.metadata?.paymentType;
        const customerEmail = session.customer_details?.email;
        const interval = paymentType === "subscription" ? "month" : "year";

        if (type === "partnership") {
          const email = session.metadata?.email;
          const project = session.metadata?.project;

          if (!email || !amount || !project) {
            console.error(
              "Missing required partnership metadata:",
              session.metadata
            );
            return NextResponse.json(
              { error: "Invalid metadata" },
              { status: 400 }
            );
          }

          // Get payment method details
          let last4: string | null = null;
          let cardType: string | null = null;
          let paymentMethodId: string | null = null;

          console.log('Session:', {
            customer: session.customer,
            payment_intent: session.payment_intent,
            subscription: session.subscription,
            mode: session.mode
          });

          // Try to get payment method from setup intent first
          if (session.setup_intent) {
            const setupIntent = await stripe.setupIntents.retrieve(
              session.setup_intent as string,
              {
                expand: ['payment_method'],
              }
            );
            
            console.log('SetupIntent:', {
              id: setupIntent.id,
              payment_method: setupIntent.payment_method
            });
            
            if (typeof setupIntent.payment_method !== 'string' && setupIntent.payment_method?.card) {
              last4 = setupIntent.payment_method.card.last4;
              cardType = setupIntent.payment_method.card.brand;
              paymentMethodId = setupIntent.payment_method.id;
            }
          }
          // If no setup intent or no card details found, try payment intent
          if ((!last4 || !cardType) && session.payment_intent) {
            const paymentIntent = await stripe.paymentIntents.retrieve(
              session.payment_intent as string,
              {
                expand: ['payment_method'],
              }
            );
            
            console.log('PaymentIntent:', {
              id: paymentIntent.id,
              payment_method: paymentIntent.payment_method,
              card: typeof paymentIntent.payment_method !== 'string' ? paymentIntent.payment_method?.card : null
            });
            
            if (typeof paymentIntent.payment_method !== 'string' && paymentIntent.payment_method?.card) {
              last4 = paymentIntent.payment_method.card.last4;
              cardType = paymentIntent.payment_method.card.brand;
              paymentMethodId = paymentIntent.payment_method.id;
            }
          }
          // If still no card details, try to get from customer's payment methods
          if (!last4 || !cardType) {
            const paymentMethods = await stripe.paymentMethods.list({
              customer: session.customer as string,
              type: 'card',
            });
            
            console.log('Customer Payment Methods:', paymentMethods.data);
            
            if (paymentMethods.data.length > 0) {
              last4 = paymentMethods.data[0].card?.last4 || null;
              cardType = paymentMethods.data[0].card?.brand || null;
              paymentMethodId = paymentMethods.data[0].id;
            }
          }

          console.log('Card Details:', {
            last4,
            cardType,
            paymentMethodId
          });

          // Update partnership status and details
          const updateData = { 
            status: 'active',
            updated_at: new Date().toISOString(),
            customer_id: session.customer as string,
            card_number: last4,
            card_type: cardType,
            payment_intent: session.payment_intent ? session.payment_intent.toString() : null,
            stripe_subscription_id: session.subscription as string,
            current_period_start: new Date(),
            current_period_end: new Date(
              Date.now() +
                (session.mode === "subscription" ? 30 : 365) * 24 * 60 * 60 * 1000
            ),
          };

          console.log('Session customer:', session.customer);
          console.log('Session subscription:', session.subscription);
          console.log('Session payment_intent:', session.payment_intent);
          console.log('Card details - last4:', last4, 'type:', cardType);

          console.log('Updating partnership with:', updateData);

          // First check if there's any existing partnership for this customer
          const { data: partnerships, error: fetchError } = await supabase
            .from('partnerships')
            .select('*')
            .or('customer_id.eq.' + session.customer + ',and(email.eq.' + email + ',status.eq.pending)')
            .limit(1);

          if (fetchError) {
            console.error("Error fetching partnership:", fetchError);
            return NextResponse.json(
              { error: "Failed to fetch partnership" },
              { status: 500 }
            );
          }

          if (!partnerships || partnerships.length === 0) {
            // Insert new partnership record if none found
            const { error: insertError } = await supabase
              .from('partnerships')
              .insert({
                email,
                amount,
                frequency: paymentType === "subscription" ? "monthly" : "annually",
                project,
                status: 'active',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                customer_id: session.customer as string,
                card_number: last4,
                card_type: cardType,
                payment_intent: session.payment_intent ? session.payment_intent.toString() : null,
                stripe_subscription_id: session.subscription as string,
                current_period_start: new Date(),
                current_period_end: new Date(
                  Date.now() +
                    (session.mode === "subscription" ? 30 : 365) * 24 * 60 * 60 * 1000
                ),
              });

            if (insertError) {
              console.error('Error creating partnership record:', insertError);
              return NextResponse.json(
                { error: "Failed to create partnership record" },
                { status: 500 }
              );
            }
          } else {
            // Now update the partnership
            const { data: updateResult, error: updateError } = await supabase
              .from('partnerships')
              .update(updateData)
              .eq('id', partnerships[0].id)
              .select();

            console.log('Update result:', updateResult);
            console.log('Update error:', updateError);

            if (updateError) {
              console.error("Error updating partnership status:", updateError);
            }
          }

          // Create transaction record for partnership
          const { error: transactionError } = await supabase
            .from("transaction_ledger")
            .insert({
              description: `Partnership payment for ${project} project with amount of ${centsToDollars(amount)}`,
              reference: session.invoice as string,
              credit: amount,
              subscription_type: session.mode === "subscription" ? "subscription" : "payment",
              tx_action: "PARTNERSHIP",
              customer_name: session.customer_details?.name || null,
              customer_email: email || null,
            });

          if (transactionError) {
            console.error("Error creating transaction:", transactionError);
          }

          // Send confirmation email for partnership
          if (email) {
            try {
              const { sendPartnershipConfirmationEmail } = await import("@/utils/email");
              const emailResult = await sendPartnershipConfirmationEmail(
                email,
                project,
                amount,
                session.mode === "subscription" ? "month" : "year"
              );

              // Log email attempt
              await supabase.from("email_logs").insert({
                email: email,
                subject: `Thank you for your partnership with Creator Share Foundation!`,
                status: emailResult.success ? "sent" : "failed",
                error: emailResult.error ? JSON.stringify(emailResult.error) : null,
                message_id: emailResult.messageId,
                created_at: new Date(),
              });
            } catch (emailError) {
              console.error("Error sending partnership email:", emailError);
              
              // Log failed email attempt
              await supabase.from("email_logs").insert({
                email: email,
                subject: `Thank you for your partnership with Creator Share Foundation!`,
                status: "failed",
                error: emailError instanceof Error ? emailError.message : String(emailError),
                created_at: new Date(),
              });
            }
          }

          return NextResponse.json(
            { message: "Partnership processed successfully" },
            { status: 200 }
          );
        }

        // Handle regular sponsorship checkout
        const beneficiaryId = session.metadata?.beneficiaryId;
        const userId = session.metadata?.userId || null;

        if (!beneficiaryId || !amount) {
          console.error(
            "Missing required metadata in Stripe session:",
            session.metadata
          );
          return NextResponse.json(
            { error: "Invalid metadata" },
            { status: 400 }
          );
        }

        // Fetch child data
        const { data: beneficiaryData, error: beneficiaryError } =
          await supabase
            .from("beneficiaries")
            .select("name, budget_raised, budget_goal, goal_fulfilled_at")
            .eq("id", beneficiaryId)
            .single();

        if (beneficiaryError || !beneficiaryData) {
          console.error("Error fetching beneficiary data:", beneficiaryError);
          return NextResponse.json(
            { error: "Failed to fetch beneficiary data" },
            { status: 500 }
          );
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
            subscription_type:
              session.mode === "subscription" ? "subscription" : "payment",
            tx_action: "SPONSORSHIP",
            customer_name: session.customer_details?.name || null,
            customer_email: customerEmail || null,
          });

        if (transactionError) {
          console.error("Error creating transaction:", transactionError);
          return NextResponse.json(
            { error: "Failed to create transaction" },
            { status: 500 }
          );
        }

        // Create activity record
        const { error: activityError } = await supabase
          .from("activities")
          .insert({
            title: "SPONSORSHIP",
            description: `Someone sponsored with $${centsToDollars(
              amount
            )}/${interval}`,
            beneficiary_id: beneficiaryId,
            user_id: userId,
          });

        if (activityError) {
          console.error("Error creating activity:", activityError);
          // Continue processing even if activity creation fails
        }

        // Check if budget goal is fulfilled and notification should be sent
        if (
          beneficiaryData.goal_fulfilled_at == null &&
          beneficiaryData.budget_raised + amount >= beneficiaryData.budget_goal
        ) {
          // Set goal_fulfilled_at
          const { error: updateGoalError } = await supabase
            .from("beneficiaries")
            .update({ goal_fulfilled_at: new Date().toISOString() })
            .eq("id", beneficiaryId);

          if (updateGoalError) {
            console.error("Error updating goal_fulfilled_at:", updateGoalError);
          } else {
            // Fetch all activity_subscriptions for this beneficiary
            const { data: subscribers, error: subError } = await supabase
              .from("activity_subscriptions")
              .select("email")
              .eq("beneficiary_id", beneficiaryId);

            if (!subError && Array.isArray(subscribers)) {
              const { sendGoalFulfilledEmail } = await import("@/utils/email");
              for (const sub of subscribers) {
                try {
                  const emailResult = await sendGoalFulfilledEmail(sub.email, {
                    name: beneficiaryData.name,
                    budget_goal: beneficiaryData.budget_goal,
                  });
                  await supabase.from("email_logs").insert({
                    email: sub.email,
                    subject: `Goal Fulfilled for ${beneficiaryData.name}!`,
                    status: emailResult.success ? "sent" : "failed",
                    error: emailResult.error
                      ? JSON.stringify(emailResult.error)
                      : null,
                    message_id: emailResult.messageId,
                    created_at: new Date(),
                  });
                } catch (emailErr) {
                  console.error(
                    "Error sending goal fulfilled email:",
                    emailErr
                  );
                  await supabase.from("email_logs").insert({
                    email: sub.email,
                    subject: `Goal Fulfilled for ${beneficiaryData.name}!`,
                    status: "failed",
                    error:
                      emailErr instanceof Error
                        ? emailErr.message
                        : String(emailErr),
                    created_at: new Date(),
                  });
                }
              }
            }
          }
        }

        if (session.mode === "subscription") {
        } else {
          const { error: subscriptionError } = await supabase
            .from("subscriptions")
            .insert({
              stripe_subscription_id: session.subscription as string,
              user_id: userId,
              beneficiary_id: beneficiaryId,
              status: "complete",
              amount: amount,
              interval: interval,
              current_period_start: new Date(),
              current_period_end: new Date(
                Date.now() +
                  (interval === "month" ? 30 : 365) * 24 * 60 * 60 * 1000
              ),
              customer_id: session.customer as string,
            });

          if (subscriptionError) {
            console.error("Error creating subscription:", subscriptionError);
            return NextResponse.json(
              { error: "Failed to create subscription" },
              { status: 500 }
            );
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
                  status: emailResult.success ? "sent" : "failed",
                  error: emailResult.error
                    ? JSON.stringify(emailResult.error)
                    : null,
                  message_id: emailResult.messageId,
                  created_at: new Date(),
                });
              } catch (err) {
                console.error("Error logging email attempt:", err);
              }
            }
          } catch (emailError) {
            console.error("Error in email sending process:", emailError);
          }
        }

        return NextResponse.json(
          { message: "Transaction processed successfully" },
          { status: 200 }
        );
      }

      case "customer.subscription.created": {
        const subscription = event.data.object as Stripe.Subscription;
        const type = subscription.metadata?.type;

        if (type === "partnership") {
          const email = subscription.metadata?.email;
          console.log('Subscription:', {
            id: subscription.id,
            customer: subscription.customer,
            latest_invoice: subscription.latest_invoice,
            metadata: subscription.metadata
          });

          if (email) {
            // Get payment method details
            let last4: string | null = null;
            let cardType: string | null = null;
            let paymentMethodId: string | null = null;

            // Get latest invoice to get payment intent
            const latestInvoice = await stripe.invoices.retrieve(subscription.latest_invoice as string);
            const paymentIntent = latestInvoice.payment_intent as string;

            if (paymentIntent) {
              const pi = await stripe.paymentIntents.retrieve(
                paymentIntent,
                {
                  expand: ['payment_method'],
                }
              );
              
              console.log('PaymentIntent:', {
                id: pi.id,
                payment_method: pi.payment_method,
                card: typeof pi.payment_method !== 'string' ? pi.payment_method?.card : null
              });
              
              if (typeof pi.payment_method !== 'string' && pi.payment_method?.card) {
                last4 = pi.payment_method.card.last4;
                cardType = pi.payment_method.card.brand;
                paymentMethodId = pi.payment_method.id;
              }
            }

            // If no card details found, try to get from customer's payment methods
            if (!last4 || !cardType) {
              const paymentMethods = await stripe.paymentMethods.list({
                customer: subscription.customer as string,
                type: 'card',
              });
              
              console.log('Customer Payment Methods:', paymentMethods.data);
              
              if (paymentMethods.data.length > 0) {
                last4 = paymentMethods.data[0].card?.last4 || null;
                cardType = paymentMethods.data[0].card?.brand || null;
                paymentMethodId = paymentMethods.data[0].id;
              }
            }

            console.log('Card Details:', {
              last4,
              cardType,
              paymentMethodId
            });

            // Update partnership record
            const updateData = {
              customer_id: subscription.customer as string,
              card_number: last4,
              card_type: cardType,
              payment_intent: paymentIntent,
              stripe_subscription_id: subscription.id,
              current_period_start: new Date(subscription.current_period_start * 1000),
              current_period_end: new Date(subscription.current_period_end * 1000),
            };

            console.log('Updating partnership with:', updateData);

            // First get the partnership record
            const { data: partnerships, error: fetchError } = await supabase
              .from('partnerships')
              .select('*')
              .eq('email', email)
              .eq('status', 'pending')
              .limit(1);

            if (fetchError) {
              console.error("Error fetching partnership:", fetchError);
              return NextResponse.json(
                { error: "Failed to fetch partnership" },
                { status: 500 }
              );
            }

            if (!partnerships || partnerships.length === 0) {
              console.error("No pending partnership found for email:", email);
              return NextResponse.json(
                { error: "No pending partnership found" },
                { status: 404 }
              );
            }

            // Now update the partnership
            const { error: updateError } = await supabase
              .from('partnerships')
              .update(updateData)
              .eq('id', partnerships[0].id);

            if (updateError) {
              console.error("Error updating partnership record:", updateError);
              return NextResponse.json(
                { error: "Failed to update partnership record" },
                { status: 500 }
              );
            }
          }
        } else {
          // Handle regular sponsorship subscription
          const { error: subscriptionError } = await supabase
            .from("subscriptions")
            .insert({
              stripe_subscription_id: subscription.id,
              user_id: subscription.metadata?.userId,
              beneficiary_id: subscription.metadata?.beneficiaryId,
              status:
                subscription.status === "active" ? "complete" : "incomplete",
              amount: subscription.items.data[0].price.unit_amount,
              interval: subscription.items.data[0].price.recurring?.interval,
              current_period_start: new Date(
                subscription.current_period_start * 1000
              ),
              current_period_end: new Date(
                subscription.current_period_end * 1000
              ),
              customer_id: subscription.customer as string,
            });

          if (subscriptionError) {
            console.error(
              "Error creating subscription record:",
              subscriptionError
            );
            return NextResponse.json(
              { error: "Failed to create subscription record" },
              { status: 500 }
            );
          }
        }

        return NextResponse.json(
          { message: "Subscription processed" },
          { status: 200 }
        );
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerEmail = invoice.customer_email;
        const subscriptionId = invoice.subscription as string;
        const type = invoice.metadata?.type;

        if (type === "partnership") {
          // Update partnership status
          const { error: updateError } = await supabase
            .from('partnerships')
            .update({ 
              status: 'cancelled',
              updated_at: new Date().toISOString()
            })
            .eq('email', customerEmail)
            .eq('status', 'active');

          if (updateError) {
            console.error("Error updating partnership status:", updateError);
          }

          return NextResponse.json(
            { message: "Partnership payment failure handled" },
            { status: 200 }
          );
        }

        // Handle regular sponsorship payment failure
        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({ status: "incomplete" })
          .eq("stripe_subscription_id", subscriptionId);

        if (updateError) {
          console.error("Error updating subscription status:", updateError);
        }

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
                status: "sent",
                created_at: new Date(),
              });
            } catch (err) {
              console.error("Error logging email attempt:", err);
            }
          } catch (emailError) {
            console.error("Error sending payment failed email:", emailError);
          }
        }

        return NextResponse.json(
          { message: "Payment failure handled" },
          { status: 200 }
        );
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;

        // Update subscription record
        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({
            status:
              subscription.status === "active" ? "complete" : "incomplete",
            current_period_start: new Date(
              subscription.current_period_start * 1000
            ),
            current_period_end: new Date(
              subscription.current_period_end * 1000
            ),
          })
          .eq("stripe_subscription_id", subscription.id);

        if (updateError) {
          console.error("Error updating subscription:", updateError);
          return NextResponse.json(
            { error: "Failed to update subscription" },
            { status: 500 }
          );
        }

        return NextResponse.json(
          { message: "Subscription updated" },
          { status: 200 }
        );
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const type = subscription.metadata?.type;

        if (type === "partnership") {
          const email = subscription.metadata?.email;
          if (email) {
            const { error: updateError } = await supabase
              .from('partnerships')
              .update({ 
                status: 'cancelled',
                updated_at: new Date().toISOString()
              })
              .eq('email', email)
              .eq('status', 'active');

            if (updateError) {
              console.error("Error updating partnership status:", updateError);
            }
          }

          return NextResponse.json(
            { message: "Partnership cancelled" },
            { status: 200 }
          );
        }

        // Handle regular sponsorship cancellation
        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({
            status: "cancelled",
            canceled_at: new Date(),
          })
          .eq("stripe_subscription_id", subscription.id);

        if (updateError) {
          console.error("Error cancelling subscription:", updateError);
          return NextResponse.json(
            { error: "Failed to cancel subscription" },
            { status: 500 }
          );
        }

        return NextResponse.json(
          { message: "Subscription cancelled" },
          { status: 200 }
        );
      }

      case "invoice.paid":
      case "invoice.payment_succeeded":
        // These events indicate successful payment of an invoice
        // We can use them to update our database if needed
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string;

        if (subscriptionId) {
          await supabase
            .from("subscriptions")
            .update({ status: "complete" })
            .eq("stripe_subscription_id", subscriptionId);
        }

        return NextResponse.json(
          { message: "Invoice payment processed" },
          { status: 200 }
        );

      case "payment_intent.succeeded":
        return NextResponse.json(
          { message: "Payment intent succeeded" },
          { status: 200 }
        );

      default:
        console.log(`Unhandled event type: ${event.type}`);
        return NextResponse.json(
          { message: `Received ${event.type} event` },
          { status: 200 }
        );
    }
  } catch (error) {
    console.error("Detailed webhook error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 }
    );
  }
}
