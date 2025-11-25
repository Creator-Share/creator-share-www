import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@/utils/supabase/client"
import { centsToDollars } from "@/utils/currency"
import {
  sendSponsorshipConfirmationEmail,
  sendPaymentFailedEmail,
  sendMonthlyPaymentConfirmationEmail,
  sendManagerSponsorshipNotificationEmail,
} from "@/utils/email"
import { notifySponsorshipReceived } from "@/services/telegram"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY! as string)

// Force dynamic rendering to prevent body pre-processing
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const supabase = createClient()
  const sig = req.headers.get("stripe-signature") as string
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not defined.")
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    )
  }

  let event

  try {
    const rawBody = await req.text()

    // Debug logging to identify the issue
    console.log('Webhook Debug:', {
      hasSignature: !!sig,
      signatureHeader: sig,
      bodyLength: rawBody.length,
      secretConfigured: !!webhookSecret,
      secretPrefix: webhookSecret?.substring(0, 7),
      body: rawBody,
    })

    event = stripe.webhooks.constructEvent(
      rawBody,
      sig as string,
      webhookSecret,
    )
  } catch (err) {
    console.error("Error verifying Stripe webhook:", err)
    return NextResponse.json(
      { error: "Webhook verification failed" },
      { status: 400 },
    )
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const type = session.metadata?.type
        const amount = parseFloat(session.metadata?.amount || "0")
        const paymentType = session.metadata?.paymentType
        const customerEmail = session.customer_details?.email
        const interval = paymentType === "subscription" ? "month" : "year"

        if (type === "partnership") {
          const email = session.metadata?.email
          const project = session.metadata?.project

          if (!email || !amount || !project) {
            console.error(
              "Missing required partnership metadata:",
              session.metadata,
            )
            return NextResponse.json(
              { error: "Invalid metadata" },
              { status: 400 },
            )
          }

          // Get payment method details
          let last4: string | null = null
          let cardType: string | null = null
          let paymentMethodId: string | null = null

          console.log("Session:", {
            customer: session.customer,
            payment_intent: session.payment_intent,
            subscription: session.subscription,
            mode: session.mode,
          })

          // Try to get payment method from setup intent first
          if (session.setup_intent) {
            const setupIntent = await stripe.setupIntents.retrieve(
              session.setup_intent as string,
              {
                expand: ["payment_method"],
              },
            )

            console.log("SetupIntent:", {
              id: setupIntent.id,
              payment_method: setupIntent.payment_method,
            })

            if (
              typeof setupIntent.payment_method !== "string" &&
              setupIntent.payment_method?.card
            ) {
              last4 = setupIntent.payment_method.card.last4
              cardType = setupIntent.payment_method.card.brand
              paymentMethodId = setupIntent.payment_method.id
            }
          }
          // If no setup intent or no card details found, try payment intent
          if ((!last4 || !cardType) && session.payment_intent) {
            const paymentIntent = await stripe.paymentIntents.retrieve(
              session.payment_intent as string,
              {
                expand: ["payment_method"],
              },
            )

            console.log("PaymentIntent:", {
              id: paymentIntent.id,
              payment_method: paymentIntent.payment_method,
              card:
                typeof paymentIntent.payment_method !== "string"
                  ? paymentIntent.payment_method?.card
                  : null,
            })

            if (
              typeof paymentIntent.payment_method !== "string" &&
              paymentIntent.payment_method?.card
            ) {
              last4 = paymentIntent.payment_method.card.last4
              cardType = paymentIntent.payment_method.card.brand
              paymentMethodId = paymentIntent.payment_method.id
            }
          }
          // If still no card details, try to get from customer's payment methods
          if (!last4 || !cardType) {
            const paymentMethods = await stripe.paymentMethods.list({
              customer: session.customer as string,
              type: "card",
            })

            console.log("Customer Payment Methods:", paymentMethods.data)

            if (paymentMethods.data.length > 0) {
              last4 = paymentMethods.data[0].card?.last4 || null
              cardType = paymentMethods.data[0].card?.brand || null
              paymentMethodId = paymentMethods.data[0].id
            }
          }

          console.log("Card Details:", {
            last4,
            cardType,
            paymentMethodId,
          })

          // Update partnership status and details
          const updateData = {
            status: "complete",
            updated_at: new Date().toISOString(),
            customer_id: session.customer as string,
            card_number: last4,
            card_type: cardType,
            payment_intent: session.payment_intent
              ? session.payment_intent.toString()
              : null,
            stripe_subscription_id: session.subscription as string,
            current_period_start: new Date(),
            current_period_end: new Date(
              Date.now() +
                (session.mode === "subscription" ? 30 : 365) *
                  24 *
                  60 *
                  60 *
                  1000,
            ),
          }

          console.log("Session customer:", session.customer)
          console.log("Session subscription:", session.subscription)
          console.log("Session payment_intent:", session.payment_intent)
          console.log("Card details - last4:", last4, "type:", cardType)

          console.log("Updating partnership with:", updateData)

          // First check if there's any existing partnership for this customer
          const { data: partnerships, error: fetchError } = await supabase
            .from("partnerships")
            .select("*")
            .or(
              "customer_id.eq." +
                session.customer +
                ",and(email.eq." +
                email +
                ",status.eq.incomplete)",
            )
            .limit(1)

          if (fetchError) {
            console.error("Error fetching partnership:", fetchError)
            return NextResponse.json(
              { error: "Failed to fetch partnership" },
              { status: 500 },
            )
          }

          if (!partnerships || partnerships.length === 0) {
            // Insert new partnership record if none found
            const { error: insertError } = await supabase
              .from("partnerships")
              .insert({
                email,
                amount,
                frequency:
                  paymentType === "subscription" ? "monthly" : "annually",
                project,
                status: "complete",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                customer_id: session.customer as string,
                card_number: last4,
                card_type: cardType,
                payment_intent: session.payment_intent
                  ? session.payment_intent.toString()
                  : null,
                stripe_subscription_id: session.subscription as string,
                current_period_start: new Date(),
                current_period_end: new Date(
                  Date.now() +
                    (session.mode === "subscription" ? 30 : 365) *
                      24 *
                      60 *
                      60 *
                      1000,
                ),
              })

            if (insertError) {
              console.error("Error creating partnership record:", insertError)
              return NextResponse.json(
                { error: "Failed to create partnership record" },
                { status: 500 },
              )
            }
          } else {
            // Now update the partnership
            const { data: updateResult, error: updateError } = await supabase
              .from("partnerships")
              .update(updateData)
              .eq("id", partnerships[0].id)
              .select()

            console.log("Update result:", updateResult)
            console.log("Update error:", updateError)

            if (updateError) {
              console.error("Error updating partnership status:", updateError)
            }
          }

          // Create transaction record for partnership
          const { error: transactionError } = await supabase
            .from("transaction_ledger")
            .insert({
              description: `Partnership payment for ${project} project with amount of ${centsToDollars(amount)}`,
              reference: session.invoice as string,
              credit: amount,
              subscription_type:
                session.mode === "subscription" ? "subscription" : "payment",
              tx_action: "PARTNERSHIP",
              customer_name: session.customer_details?.name || null,
              customer_email: email || null,
            })

          if (transactionError) {
            console.error("Error creating transaction:", transactionError)
          }

          // Send confirmation email for partnership
          if (email) {
            try {
              const { sendPartnershipConfirmationEmail } = await import(
                "@/utils/email"
              )
              const emailResult = await sendPartnershipConfirmationEmail(
                email,
                project,
                amount,
                session.mode === "subscription" ? "month" : "year",
              )

              // Log email attempt
              await supabase.from("email_logs").insert({
                email: email,
                subject: `Thank you for your partnership with Creator Share Foundation!`,
                status: emailResult.success ? "sent" : "failed",
                error: emailResult.error
                  ? JSON.stringify(emailResult.error)
                  : null,
                message_id: emailResult.messageId,
                created_at: new Date(),
              })
            } catch (emailError) {
              console.error("Error sending partnership email:", emailError)

              // Log failed email attempt
              await supabase.from("email_logs").insert({
                email: email,
                subject: `Thank you for your partnership with Creator Share Foundation!`,
                status: "failed",
                error:
                  emailError instanceof Error
                    ? emailError.message
                    : String(emailError),
                created_at: new Date(),
              })
            }
          }

          return NextResponse.json(
            { message: "Partnership processed successfully" },
            { status: 200 },
          )
        }

        // Handle regular sponsorship checkout
        const beneficiaryId = session.metadata?.beneficiaryId
        const userId = session.metadata?.userId || null

        if (!beneficiaryId || !amount) {
          console.error(
            "Missing required metadata in Stripe session:",
            session.metadata,
          )
          return NextResponse.json(
            { error: "Invalid metadata" },
            { status: 400 },
          )
        }


        // Fetch child data
        const { data: beneficiaryData, error: beneficiaryError } =
          await supabase
            .from("beneficiaries")
            .select("name, budget_raised, budget_goal, goal_fulfilled_at")
            .eq("id", beneficiaryId)
            .single()

        if (beneficiaryError || !beneficiaryData) {
          console.error("Error fetching beneficiary data:", beneficiaryError)
          return NextResponse.json(
            { error: "Failed to fetch beneficiary data" },
            { status: 500 },
          )
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
          })

        if (transactionError) {
          console.error("Error creating transaction:", transactionError)
          return NextResponse.json(
            { error: "Failed to create transaction" },
            { status: 500 },
          )
        }

        // Create activity record
        const { error: activityError } = await supabase
          .from("activities")
          .insert({
            title: "SPONSORSHIP",
            description: `Someone sponsored with $${centsToDollars(
              amount,
            )}/${interval}`,
            beneficiary_id: beneficiaryId,
            user_id: userId,
          })

        if (activityError) {
          console.error("Error creating activity:", activityError)
          // Continue processing even if activity creation fails
        }

        // Check if budget goal is fulfilled and notification should be sent
        // Use server-side hardcoded override when configured
        const hardcoded = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL
        const effectiveGoal =
          hardcoded !== null ? hardcoded : beneficiaryData.budget_goal

        if (
          beneficiaryData.goal_fulfilled_at == null &&
          beneficiaryData.budget_raised + amount >= effectiveGoal
        ) {
          // Set goal_fulfilled_at
          const { error: updateGoalError } = await supabase
            .from("beneficiaries")
            .update({ goal_fulfilled_at: new Date().toISOString() })
            .eq("id", beneficiaryId)

          if (updateGoalError) {
            console.error("Error updating goal_fulfilled_at:", updateGoalError)
          } else {
            // Fetch all activity_subscriptions for this beneficiary
            const { data: subscribers, error: subError } = await supabase
              .from("activity_subscriptions")
              .select("email")
              .eq("beneficiary_id", beneficiaryId)

            if (!subError && Array.isArray(subscribers)) {
              const { sendGoalFulfilledEmail } = await import("@/utils/email")
              for (const sub of subscribers) {
                try {
                  const emailResult = await sendGoalFulfilledEmail(sub.email, {
                    name: beneficiaryData.name,
                    budget_goal: beneficiaryData.budget_goal,
                  })
                  await supabase.from("email_logs").insert({
                    email: sub.email,
                    subject: `Goal Fulfilled for ${beneficiaryData.name}!`,
                    status: emailResult.success ? "sent" : "failed",
                    error: emailResult.error
                      ? JSON.stringify(emailResult.error)
                      : null,
                    message_id: emailResult.messageId,
                    created_at: new Date(),
                  })
                } catch (emailErr) {
                  console.error("Error sending goal fulfilled email:", emailErr)
                  await supabase.from("email_logs").insert({
                    email: sub.email,
                    subject: `Goal Fulfilled for ${beneficiaryData.name}!`,
                    status: "failed",
                    error:
                      emailErr instanceof Error
                        ? emailErr.message
                        : String(emailErr),
                    created_at: new Date(),
                  })
                }
              }
            }
          }
        }

        // Update or create subscription record
        if (session.mode === "subscription" && session.subscription) {
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
                  (interval === "month" ? 30 : 365) * 24 * 60 * 60 * 1000,
              ),
              customer_id: session.customer as string,
              sponsorship_method: "STRIPE",
            })

          // Check if this failed due to duplicate constraint
          if (subscriptionError) {
            // Code 23505 = unique_violation in PostgreSQL
            if (subscriptionError.code === '23505') {
              console.warn("Duplicate sponsorship detected - DB constraint prevented duplicate:", {
                beneficiaryId,
                sessionId: session.id,
                error: subscriptionError
              })
              
              // Cancel the Stripe subscription to stop future charges
              try {
                if (session.subscription) {
                  await stripe.subscriptions.cancel(session.subscription as string)
                  console.log("Cancelled duplicate Stripe subscription:", session.subscription)
                }
              } catch (cancelError) {
                console.error("Failed to cancel duplicate subscription:", cancelError)
              }
              
              // Send apology email to the customer
              if (customerEmail) {
                try {
                  const { sendDuplicateSponsorshipEmail } = await import("@/utils/email")
                  await sendDuplicateSponsorshipEmail(
                    customerEmail,
                    beneficiaryData.name,
                    amount
                  )
                  
                  // Log the apology email
                  await supabase.from("email_logs").insert({
                    email: customerEmail,
                    subject: `Important: Duplicate Sponsorship Prevented for ${beneficiaryData.name}`,
                    status: "sent",
                    created_at: new Date(),
                  })
                } catch (emailError) {
                  console.error("Failed to send duplicate sponsorship email:", emailError)
                  
                  // If no custom email function exists, send a generic notification
                  console.log("TODO: Create sendDuplicateSponsorshipEmail function")
                  
                  // Log the attempt anyway
                  await supabase.from("email_logs").insert({
                    email: customerEmail,
                    subject: `Important: Duplicate Sponsorship Prevented for ${beneficiaryData.name}`,
                    status: "failed",
                    error: "Email function not implemented",
                    created_at: new Date(),
                  })
                }
              }
              
              // Return success to Stripe (we handled it gracefully)
              return NextResponse.json(
                { 
                  message: "Duplicate sponsorship prevented - subscription cancelled and customer notified",
                  duplicate: true
                },
                { status: 200 },
              )
            }
            
            // Other database errors
            console.error("Error creating subscription:", subscriptionError)
            return NextResponse.json(
              { error: "Failed to create subscription" },
              { status: 500 },
            )
          }
        }

        // Send confirmation emails
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
          console.warn("Email configuration missing - skipping email send")
        } else {
          // Send confirmation to sponsor if we have their email
          if (customerEmail) {
            try {
              const emailResult = await sendSponsorshipConfirmationEmail(
                customerEmail,
                beneficiaryData.name,
                amount,
                interval,
              )

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
                })
              } catch (err) {
                console.error("Error logging email attempt:", err)
              }
            } catch (emailError) {
              console.error("Error in email sending process:", emailError)
            }
          }

          // Send notification to manager
          if (!process.env.MANAGER_EMAIL) {
            console.warn("MANAGER_EMAIL not configured - skipping manager notification")
          } else {
            try {
              const managerEmailResult = await sendManagerSponsorshipNotificationEmail(
              beneficiaryData.name,
              amount,
              interval,
              customerEmail,
              session.customer_details?.name,
            )

            // Log manager email attempt
            try {
              await supabase.from("email_logs").insert({
                email: process.env.MANAGER_EMAIL!,
                subject: `New Sponsorship Received for ${beneficiaryData.name}`,
                status: managerEmailResult.success ? "sent" : "failed",
                error: managerEmailResult.error
                  ? JSON.stringify(managerEmailResult.error)
                  : null,
                message_id: managerEmailResult.messageId,
                created_at: new Date(),
              })
            } catch (err) {
              console.error("Error logging manager email attempt:", err)
            }
            } catch (emailError) {
              console.error("Error sending manager notification:", emailError)
            }
          }
        }

        // Send Telegram notification for sponsorship
        try {
          await notifySponsorshipReceived({
            sponsorName: session.customer_details?.name || customerEmail?.split('@')[0] || "Anonymous Sponsor",
            sponsorEmail: customerEmail || "No email provided",
            amount: amount,
            beneficiaryId: beneficiaryId,
            beneficiaryName: beneficiaryData.name,
            paymentMethod: "Stripe",
            paymentReference: session.id,
            interval: interval,
          });
        } catch (telegramError) {
          console.error('Telegram sponsorship notification failed:', telegramError);
          // Don't fail the webhook if Telegram notification fails
        }

        return NextResponse.json(
          { message: "Transaction processed successfully" },
          { status: 200 },
        )
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice
        const customerEmail = invoice.customer_email
        const subscriptionId = invoice.subscription as string
        const type = invoice.metadata?.type

        if (type === "partnership") {
          // Update partnership status
          const { error: updateError } = await supabase
            .from("partnerships")
            .update({
              status: "cancelled",
              updated_at: new Date().toISOString(),
            })
            .eq("email", customerEmail)
            .eq("status", "complete")

          if (updateError) {
            console.error("Error updating partnership status:", updateError)
          }

          return NextResponse.json(
            { message: "Partnership payment failure handled" },
            { status: 200 },
          )
        }

        // Handle regular sponsorship payment failure
        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({ status: "incomplete" })
          .eq("stripe_subscription_id", subscriptionId)

        if (updateError) {
          console.error("Error updating subscription status:", updateError)
        }

        const { data: subscriptionData } = await supabase
          .from("subscriptions")
          .select(`beneficiary_id`)
          .eq("stripe_subscription_id", subscriptionId)
          .single()

        let beneficiaryName = "your sponsored beneficiary"
        if (subscriptionData?.beneficiary_id) {
          const { data: sponsorship } = await supabase
            .from("beneficiaries")
            .select("name")
            .eq("id", subscriptionData.beneficiary_id)
            .single()

          if (sponsorship) {
            beneficiaryName = sponsorship.name
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
                : null,
            )

            // Log email attempt
            try {
              await supabase.from("email_logs").insert({
                email: customerEmail,
                subject: `Payment failed for ${beneficiaryName} sponsorship`,
                status: "sent",
                created_at: new Date(),
              })
            } catch (err) {
              console.error("Error logging email attempt:", err)
            }
          } catch (emailError) {
            console.error("Error sending payment failed email:", emailError)
          }
        }

        return NextResponse.json(
          { message: "Payment failure handled" },
          { status: 200 },
        )
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription

        // Update subscription record
        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({
            status: "complete",
            current_period_start: new Date(
              subscription.current_period_start * 1000,
            ),
            current_period_end: new Date(
              subscription.current_period_end * 1000,
            ),
          })
          .eq("stripe_subscription_id", subscription.id)

        if (updateError) {
          console.error("Error updating subscription:", updateError)
          return NextResponse.json(
            { error: "Failed to update subscription" },
            { status: 500 },
          )
        }

        return NextResponse.json(
          { message: "Subscription updated" },
          { status: 200 },
        )
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription
        const type = subscription.metadata?.type

        if (type === "partnership") {
          const email = subscription.metadata?.email
          if (email) {
            const { error: updateError } = await supabase
              .from("partnerships")
              .update({
                status: "cancelled",
                updated_at: new Date().toISOString(),
              })
              .eq("email", email)
              .eq("status", "complete")

            if (updateError) {
              console.error("Error updating partnership status:", updateError)
            }
          }

          return NextResponse.json(
            { message: "Partnership cancelled" },
            { status: 200 },
          )
        }

        // Handle regular sponsorship cancellation
        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({
            status: "cancelled",
            canceled_at: new Date(),
          })
          .eq("stripe_subscription_id", subscription.id)

        if (updateError) {
          console.error("Error cancelling subscription:", updateError)
          return NextResponse.json(
            { error: "Failed to cancel subscription" },
            { status: 500 },
          )
        }

        return NextResponse.json(
          { message: "Subscription cancelled" },
          { status: 200 },
        )
      }

      case "invoice.paid":
      case "invoice.payment_succeeded": {
        // These events indicate successful payment of an invoice
        // We can use them to update our database and send monthly payment confirmations
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = invoice.subscription as string

        if (subscriptionId) {
          // Update subscription status
          await supabase
            .from("subscriptions")
            .update({ status: "complete" })
            .eq("stripe_subscription_id", subscriptionId)

          // Send monthly payment confirmation email
          // Only send for recurring subscriptions (not one-time payments)
          if (invoice.billing_reason === "subscription_cycle" || invoice.billing_reason === "subscription_update") {
            try {
              // Get subscription details to find beneficiary and customer email
              const { data: subscriptionData } = await supabase
                .from("subscriptions")
                .select("beneficiary_id, user_id, amount")
                .eq("stripe_subscription_id", subscriptionId)
                .single()

              if (subscriptionData?.beneficiary_id) {
                // Get beneficiary name
                const { data: beneficiaryData } = await supabase
                  .from("beneficiaries")
                  .select("name")
                  .eq("id", subscriptionData.beneficiary_id)
                  .single()

                // Get customer email from Stripe
                let customerEmail: string | null = null
                if (invoice.customer) {
                  try {
                    const customer = await stripe.customers.retrieve(
                      invoice.customer as string
                    )
                    if (!customer.deleted && "email" in customer) {
                      customerEmail = customer.email
                    }
                  } catch (err) {
                    console.error("Error fetching customer email:", err)
                  }
                }

                // Send monthly payment confirmation email
                if (customerEmail && beneficiaryData) {
                  try {
                    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
                      console.warn("Email configuration missing - skipping payment confirmation email")
                    } else {
                      const emailResult = await sendMonthlyPaymentConfirmationEmail(
                        customerEmail,
                        beneficiaryData.name,
                        invoice.amount_paid,
                      )

                      // Log email attempt
                      try {
                        await supabase.from("email_logs").insert({
                          user_id: subscriptionData.user_id,
                          email: customerEmail,
                          subject: `Payment Confirmation: Your Sponsorship for ${beneficiaryData.name}`,
                          status: emailResult.success ? "sent" : "failed",
                          error: emailResult.error
                            ? JSON.stringify(emailResult.error)
                            : null,
                          message_id: emailResult.messageId,
                          created_at: new Date(),
                        })
                      } catch (err) {
                        console.error("Error logging email attempt:", err)
                      }
                    }
                  } catch (emailError) {
                    console.error("Error sending monthly payment confirmation email:", emailError)
                  }
                }
              }
            } catch (error) {
              console.error("Error processing monthly payment confirmation:", error)
              // Don't fail the webhook - payment was successful
            }
          }
        }

        return NextResponse.json(
          { message: "Invoice payment processed" },
          { status: 200 },
        )
      }

      case "payment_intent.succeeded": {
        return NextResponse.json(
          { message: "Payment intent succeeded" },
          { status: 200 },
        )
      }

      case "checkout.session.expired":
      case "checkout.session.async_payment_failed": {
        return NextResponse.json(
          { message: "Payment failed or expired" },
          { status: 200 }
        )
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
        return NextResponse.json(
          { message: `Received ${event.type} event` },
          { status: 200 },
        )
    }
  } catch (error) {
    console.error("Detailed webhook error:", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 500 },
    )
  }
}
