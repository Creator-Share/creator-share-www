import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@/utils/supabase/client"
import { centsToDollars } from "@/utils/currency"
import {
  sendSponsorshipConfirmationEmail,
  sendBlindSponsorshipConfirmationEmail,
  sendPaymentFailedEmail,
  sendMonthlyPaymentConfirmationEmail,
  sendManagerSponsorshipNotificationEmail,
} from "@/utils/email"
import { notifySponsorshipReceived } from "@/services/telegram"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY! as string)

// Force dynamic rendering to prevent body pre-processing
export const dynamic = 'force-dynamic'

// Debug mode - only enable in development or for troubleshooting
const DEBUG_MODE = process.env.STRIPE_WEBHOOK_DEBUG === 'true'

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
            if (DEBUG_MODE) {
              console.log ('[DEBUG] Partnership payment missing required metadata - silently rejecting')
            }
            // Partnership payment missing required metadata - silently reject
            return NextResponse.json(
              { received: true },
              { status: 200 },
            )
          }

          // Get payment method details
          let last4: string | null = null
          let cardType: string | null = null

          // Try to get payment method from setup intent first
          if (session.setup_intent) {
            const setupIntent = await stripe.setupIntents.retrieve(
              session.setup_intent as string,
              {
                expand: ["payment_method"],
              },
            )

            if (
              typeof setupIntent.payment_method !== "string" &&
              setupIntent.payment_method?.card
            ) {
              last4 = setupIntent.payment_method.card.last4
              cardType = setupIntent.payment_method.card.brand
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

            if (
              typeof paymentIntent.payment_method !== "string" &&
              paymentIntent.payment_method?.card
            ) {
              last4 = paymentIntent.payment_method.card.last4
              cardType = paymentIntent.payment_method.card.brand
            }
          }
          // If still no card details, try to get from customer's payment methods
          if (!last4 || !cardType) {
            const paymentMethods = await stripe.paymentMethods.list({
              customer: session.customer as string,
              type: "card",
            })

            if (paymentMethods.data.length > 0) {
              last4 = paymentMethods.data[0].card?.last4 || null
              cardType = paymentMethods.data[0].card?.brand || null
            }
          }

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
            const { error: updateError } = await supabase
              .from("partnerships")
              .update(updateData)
              .eq("id", partnerships[0].id)
              .select()

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
                session.customer_details?.name || null,
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

        // Handle regular or blind sponsorship checkout
        const sponsorshipMode = session.metadata?.sponsorshipMode || "standard"
        const isBlindSponsorship = sponsorshipMode === "blind"
        const beneficiaryId = session.metadata?.beneficiaryId || null
        const beneficiaryNameFromMetadata = session.metadata?.beneficiaryName
        const blindLabel =
          session.metadata?.blindLabel || "the next child who needs support"
        const userId = session.metadata?.userId || null

        if ((!beneficiaryId && !isBlindSponsorship) || !amount) {
          if (DEBUG_MODE) {
            console.error(
              "Missing required metadata in Stripe session:",
              session.metadata,
            )
          }
          // Non-application payment - silently acknowledge without logging customer data
          return NextResponse.json(
            { received: true },
            { status: 200 },
          )
        }


        // Step 1: Insert subscription first - trigger will validate atomically
        if (session.mode === "subscription" && session.subscription) {
          const { error: subscriptionError } = await supabase
            .from("subscriptions")
            .insert({
              stripe_subscription_id: session.subscription as string,
              user_id: userId,
              beneficiary_id: beneficiaryId || null,
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

          // Step 2: Handle subscription insert errors
          if (subscriptionError) {
            console.error("Subscription insert failed:", subscriptionError)
            
            // Check for beneficiary status rejection from trigger
            if (subscriptionError.message?.includes('beneficiary_not_accepting_subscriptions')) {
              
              console.warn("Beneficiary cannot accept subscriptions - initiating rejection flow:", {
                beneficiaryId,
                sessionId: session.id,
                amount,
                interval,
                customerEmail,
                error: subscriptionError.message
              })
              
              // Step 1: Fetch beneficiary name for emails
              const { data: beneficiaryData } = await supabase
                .from("beneficiaries")
                .select("name")
                .eq("id", beneficiaryId)
                .single()
              
              const beneficiaryName = beneficiaryData?.name || "Unknown Beneficiary"
              
              // Track operation statuses
              let subscriptionCancelled = false
              let paymentRefunded = false
              let emailSent = false
              
              // Step 2: Cancel the Stripe subscription
              try {
                if (session.subscription) {
                  await stripe.subscriptions.cancel(session.subscription as string)
                  subscriptionCancelled = true
                  console.log("Cancelled subscription for fulfilled beneficiary:", {
                    subscriptionId: session.subscription,
                    beneficiaryId,
                    sessionId: session.id
                  })
                }
              } catch (cancelError) {
                console.error("Failed to cancel subscription:", {
                  error: cancelError,
                  subscriptionId: session.subscription,
                  beneficiaryId,
                  sessionId: session.id
                })
              }
              
              // Step 3: Refund the payment
              try {
                // Retrieve full session with expanded payment_intent if not already available
                let paymentIntentId: string | null = session.payment_intent as string | null
                
                if (!paymentIntentId) {
                  // Try to get payment intent from the session by retrieving it with expansion
                  try {
                    const expandedSession = await stripe.checkout.sessions.retrieve(session.id, {
                      expand: ['payment_intent', 'invoice.payment_intent']
                    })
                    paymentIntentId = expandedSession.payment_intent as string | null
                    
                    // If still not found, try from invoice
                    if (!paymentIntentId && expandedSession.invoice) {
                      const invoice = typeof expandedSession.invoice === 'string' 
                        ? await stripe.invoices.retrieve(expandedSession.invoice)
                        : expandedSession.invoice
                      paymentIntentId = invoice.payment_intent as string | null
                    }
                  } catch (retrieveError) {
                    console.error("Error retrieving session for payment_intent:", retrieveError)
                  }
                }
                
                if (paymentIntentId) {
                  const refund = await stripe.refunds.create({
                    payment_intent: paymentIntentId,
                    reason: 'requested_by_customer',
                    metadata: {
                      beneficiaryId: beneficiaryId,
                      beneficiaryName: beneficiaryName,
                      sessionId: session.id,
                      rejectionReason: 'beneficiary_already_fulfilled',
                      amount: amount.toString(),
                      customerEmail: customerEmail || 'unknown'
                    }
                  })
                  
                  paymentRefunded = true
                  console.log("Refund created for fulfilled beneficiary:", {
                    refundId: refund.id,
                    amount: refund.amount,
                    status: refund.status,
                    beneficiaryId,
                    sessionId: session.id
                  })
                } else {
                  console.error("CRITICAL: No payment_intent available for refund:", {
                    sessionId: session.id,
                    beneficiaryId,
                    amount,
                    customerEmail,
                    sessionPaymentIntent: session.payment_intent,
                    sessionInvoice: session.invoice
                  })
                }
              } catch (refundError) {
                console.error("CRITICAL: Failed to refund payment:", {
                  error: refundError,
                  errorMessage: refundError instanceof Error ? refundError.message : String(refundError),
                  paymentIntent: session.payment_intent,
                  beneficiaryId,
                  sessionId: session.id,
                  amount,
                  customerEmail,
                  requiresManualIntervention: true
                })
              }
              
              // Step 4: Send rejection email
              if (customerEmail) {
                try {
                  const { sendBudgetFulfilledRejectionEmail } = await import("@/utils/email")
                  await sendBudgetFulfilledRejectionEmail(
                    customerEmail,
                    beneficiaryName,
                    amount,
                    session.customer_details?.name || null,
                    beneficiaryId,
                  )
                  
                  emailSent = true
                  
                  await supabase.from("email_logs").insert({
                    user_id: userId,
                    email: customerEmail,
                    subject: `Thank You - ${beneficiaryName} Has Been Fully Sponsored!`,
                    status: "sent",
                    created_at: new Date(),
                  })
                } catch (emailError) {
                  console.error("Failed to send rejection email:", {
                    error: emailError,
                    customerEmail,
                    sessionId: session.id
                  })
                  
                  await supabase.from("email_logs").insert({
                    user_id: userId,
                    email: customerEmail,
                    subject: `Thank You - ${beneficiaryName} Has Been Fully Sponsored!`,
                    status: "failed",
                    error: emailError instanceof Error ? emailError.message : "Email send failed",
                    created_at: new Date(),
                  })
                }
              }
              
              // Step 5: Final logging
              if (paymentRefunded && subscriptionCancelled && emailSent) {
                console.log("Beneficiary rejection flow completed successfully:", {
                  beneficiaryId,
                  beneficiaryName,
                  sessionId: session.id,
                  operations: { subscriptionCancelled, paymentRefunded, emailSent }
                })
              } else {
                console.error("Beneficiary rejection flow partially failed:", {
                  beneficiaryId,
                  sessionId: session.id,
                  operations: { subscriptionCancelled, paymentRefunded, emailSent },
                  requiresManualIntervention: !paymentRefunded
                })
              }
              
              // Step 6: Return success to Stripe
              return NextResponse.json(
                {
                  message: "Beneficiary fulfilled - subscription cancelled and payment refunded",
                  rejected: true,
                  beneficiaryId,
                  operations: { subscriptionCancelled, paymentRefunded, emailSent }
                },
                { status: 200 }
              )
            }
            
            // Other database errors - re-throw
            throw subscriptionError
          }
        }

        // Step 3: Fetch beneficiary name for emails and transaction ledger (AFTER successful insert)
        let beneficiaryName =
          beneficiaryNameFromMetadata ||
          (isBlindSponsorship
            ? `Blind sponsorship for ${blindLabel}`
            : "Unknown Beneficiary")

        if (beneficiaryId) {
          const { data: beneficiaryData, error: beneficiaryError } =
            await supabase
              .from("beneficiaries")
              .select("name")
              .eq("id", beneficiaryId)
              .single()

          if (beneficiaryError || !beneficiaryData) {
            console.error("Error fetching beneficiary data:", beneficiaryError)
            // Continue processing - this is not critical
          } else if (beneficiaryData?.name) {
            beneficiaryName = beneficiaryData.name
          }
        }

        // Step 4: Create transaction ledger entry (AFTER successful subscription insert)
        // This is a separate operation - log error but don't rollback subscription
        const { error: transactionError } = await supabase
          .from("transaction_ledger")
          .insert({
            beneficiary_id: beneficiaryId || null,
            user_id: userId,
            description: `Sponsorship to ${beneficiaryName} with amount of ${amount}`,
            reference: session.invoice as string,
            credit: amount,
            subscription_type:
              session.mode === "subscription" ? "subscription" : "payment",
            tx_action: "SPONSORSHIP",
            customer_name: session.customer_details?.name || null,
            customer_email: customerEmail || null,
          })

        if (transactionError) {
          console.error("CRITICAL: Transaction ledger insert failed (subscription already created):", {
            beneficiaryId,
            userId,
            amount,
            sessionId: session.id,
            error: transactionError
          })
          // Log but continue - subscription is already created successfully
        }

        // Step 5: Create activity record
        const { error: activityError } = await supabase
          .from("activities")
          .insert({
            title: "SPONSORSHIP",
            description: `Someone sponsored with $${centsToDollars(
              amount,
            )}/${interval}`,
            beneficiary_id: beneficiaryId || null,
            user_id: userId,
          })

        if (activityError) {
          console.error("Error creating activity:", activityError)
          // Continue - not critical
        }

        // Send confirmation emails
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
          console.warn("Email configuration missing - skipping email send")
        } else {
          // Send confirmation to sponsor if we have their email
          if (customerEmail) {
            try {
              console.log("Sending blind sponsorship confirmation email:", {
                email: customerEmail,
                isBlindSponsorship,
                amount,
                interval,
                blindLabel,
                sessionId: session.id,
              })
              
              const emailResult = isBlindSponsorship
                ? await sendBlindSponsorshipConfirmationEmail(
                    customerEmail,
                    amount,
                    interval,
                    blindLabel,
                    session.customer_details?.name || null,
                  )
                : await sendSponsorshipConfirmationEmail(
                    customerEmail,
                    beneficiaryName,
                    amount,
                    interval,
                    session.customer_details?.name || null,
                    beneficiaryId || null,
                  )

              console.log("Email send result:", {
                success: emailResult.success,
                messageId: emailResult.messageId,
                error: emailResult.error,
              })

              // Log email attempt
              try {
                await supabase.from("email_logs").insert({
                  user_id: userId,
                  email: customerEmail,
                  subject: isBlindSponsorship
                    ? "Thank you for your blind sponsorship!"
                    : `Thank you for sponsoring ${beneficiaryName}!`,
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
              // Log the error to email_logs even if sending failed
              try {
                await supabase.from("email_logs").insert({
                  user_id: userId,
                  email: customerEmail,
                  subject: isBlindSponsorship
                    ? "Thank you for your blind sponsorship!"
                    : `Thank you for sponsoring ${beneficiaryName}!`,
                  status: "failed",
                  error: emailError instanceof Error ? emailError.message : String(emailError),
                  created_at: new Date(),
                })
              } catch (logErr) {
                console.error("Error logging failed email attempt:", logErr)
              }
            }
          } else {
            console.warn("No customer email found in session, skipping email send:", {
              sessionId: session.id,
              customerDetails: session.customer_details,
              metadata: session.metadata,
            })
          }

          // Send notification to manager
          if (!process.env.MANAGER_EMAIL) {
            console.warn("MANAGER_EMAIL not configured - skipping manager notification")
          } else {
            try {
              const managerEmailResult = await sendManagerSponsorshipNotificationEmail(
              beneficiaryName,
              amount,
              interval,
              customerEmail,
              session.customer_details?.name,
              beneficiaryId || null,
            )

            // Log manager email attempt
            try {
              await supabase.from("email_logs").insert({
                email: process.env.MANAGER_EMAIL!,
                subject: `New Sponsorship Received for ${beneficiaryName}`,
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
            beneficiaryName: beneficiaryName,
            paymentMethod: "Stripe",
            paymentReference: session.id,
            interval: interval,
          });
        } catch (telegramError) {
          console.error('Telegram sponsorship notification failed:', telegramError);
          // Don't fail the webhook if Telegram notification fails
        }

        // Step 6: Auto-match blind sponsorships
        if (isBlindSponsorship && session.subscription) {
          console.log("Attempting to auto-match blind sponsorship:", {
            stripeSubscriptionId: session.subscription,
            sessionId: session.id,
          })
          
          try {
            // Call the matching endpoint to automatically assign an available beneficiary
            const matchResponse = await fetch(
              `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/admin/blind-sponsorships/match?stripeSubscriptionId=${session.subscription}`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
              }
            )
            
            if (matchResponse.ok) {
              const matchData = await matchResponse.json()
              console.log("Blind sponsorship auto-matched successfully:", {
                subscriptionId: session.subscription,
                beneficiary: matchData.beneficiary,
              })
            } else {
              const errorData = await matchResponse.json()
              console.warn("Blind sponsorship auto-match failed:", {
                subscriptionId: session.subscription,
                status: matchResponse.status,
                error: errorData.error,
              })
              // Don't fail the webhook - matching can be done manually later
            }
          } catch (matchError) {
            console.error("Error auto-matching blind sponsorship:", {
              subscriptionId: session.subscription,
              error: matchError instanceof Error ? matchError.message : String(matchError),
            })
            // Don't fail the webhook - matching can be done manually later
          }
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

        // Silently acknowledge non-application payments
        if (type !== "partnership" && !subscriptionId) {
          if (DEBUG_MODE) {
            console.log('[DEBUG] Non-application invoice.payment_failed event - silently acknowledging')
          }
          return NextResponse.json({ received: true }, { status: 200 })
        }

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

        const { data: subscriptionData, error: subscriptionError } = await supabase
          .from("subscriptions")
          .select(`beneficiary_id`)
          .eq("stripe_subscription_id", subscriptionId)
          .maybeSingle()

        if (subscriptionError) {
          console.error("Error fetching subscription for payment failed email:", subscriptionError)
        }

        let beneficiaryName = "your sponsored beneficiary"
        if (subscriptionData?.beneficiary_id) {
          const { data: sponsorship, error: beneficiaryError } = await supabase
            .from("beneficiaries")
            .select("name")
            .eq("id", subscriptionData.beneficiary_id)
            .maybeSingle()

          if (beneficiaryError) {
            console.error("Error fetching beneficiary for payment failed email:", beneficiaryError)
          }

          if (sponsorship) {
            beneficiaryName = sponsorship.name
          }
        }

        // Send payment failed email
        if (customerEmail) {
          try {
            // Get customer name from Stripe
            let customerName: string | null = null
            if (invoice.customer) {
              try {
                const customer = await stripe.customers.retrieve(
                  invoice.customer as string
                )
                if (!customer.deleted && "name" in customer && customer.name) {
                  customerName = customer.name
                }
              } catch (err) {
                console.error("Error fetching customer name:", err)
              }
            }
            
            await sendPaymentFailedEmail(
              customerEmail,
              beneficiaryName,
              invoice.amount_due / 100,
              invoice.next_payment_attempt
                ? new Date(invoice.next_payment_attempt * 1000)
                : null,
              customerName,
              subscriptionData?.beneficiary_id || null,
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
        const type = subscription.metadata?.type

        // Silently acknowledge non-application subscriptions (no type or unknown type)
        if (!type || (type !== "partnership" && type !== "sponsorship")) {
          if (DEBUG_MODE) {
            console.log('[DEBUG] Non-application subscription.updated event - silently acknowledging')
          }
          return NextResponse.json({ received: true }, { status: 200 })
        }

        // Map Stripe subscription status to our database status
        // Stripe statuses: active, past_due, canceled, unpaid, incomplete, incomplete_expired, trialing, paused
        let dbStatus = "complete"
        if (subscription.status === "active") {
          dbStatus = "complete"
        } else if (subscription.status === "past_due" || subscription.status === "unpaid") {
          dbStatus = "incomplete"
        } else if (subscription.status === "canceled") {
          dbStatus = "cancelled"
        } else if (subscription.status === "incomplete" || subscription.status === "incomplete_expired") {
          dbStatus = "incomplete"
        }

        // Update subscription record
        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({
            status: dbStatus,
            current_period_start: subscription.current_period_start
              ? new Date(subscription.current_period_start * 1000)
              : null,
            current_period_end: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000)
              : null,
          })
          .eq("stripe_subscription_id", subscription.id)

        if (updateError) {
          console.error("Error updating subscription:", updateError)
          // Don't fail the webhook - log and continue
          console.error("Subscription update failed for:", {
            subscriptionId: subscription.id,
            status: subscription.status,
            error: updateError,
          })
        }

        return NextResponse.json(
          { message: "Subscription updated" },
          { status: 200 },
        )
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription
        const type = subscription.metadata?.type

        // Silently acknowledge non-application subscriptions (no type or unknown type)
        if (!type || (type !== "partnership" && type !== "sponsorship")) {
          if (DEBUG_MODE) {
            console.log('[DEBUG] Non-application subscription.deleted event - silently acknowledging')
          }
          return NextResponse.json({ received: true }, { status: 200 })
        }

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
        // First, get the subscription to find beneficiary_id
        const { data: subscriptionData, error: fetchError } = await supabase
          .from("subscriptions")
          .select("beneficiary_id, amount, user_id")
          .eq("stripe_subscription_id", subscription.id)
          .maybeSingle()

        if (fetchError) {
          console.error("Error fetching subscription:", fetchError)
        }

        // Update subscription status
        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({
            status: "cancelled",
            canceled_at: new Date(),
          })
          .eq("stripe_subscription_id", subscription.id)

        if (updateError) {
          console.error("Error cancelling subscription:", updateError)
          // Don't fail the webhook - subscription may not exist in our DB
          console.warn("Subscription cancellation update failed:", {
            subscriptionId: subscription.id,
            error: updateError,
          })
        }

        // Check if beneficiary has any active subscriptions and update status if needed
        if (subscriptionData?.beneficiary_id) {
          const { data: activeSubscriptions, error: activeError } = await supabase
            .from("subscriptions")
            .select("id")
            .eq("beneficiary_id", subscriptionData.beneficiary_id)
            .eq("status", "complete")

          if (!activeError && (!activeSubscriptions || activeSubscriptions.length === 0)) {
            // No active subscriptions - check current status and update if needed
            const { data: beneficiary, error: beneficiaryError } = await supabase
              .from("beneficiaries")
              .select("id, name, status")
              .eq("id", subscriptionData.beneficiary_id)
              .single()

            if (!beneficiaryError && beneficiary) {
              // Only update to "Sponsorship Cancelled" if not already Draft or Archived
              if (beneficiary.status !== "Draft" && beneficiary.status !== "Archived") {
                const { error: statusUpdateError } = await supabase
                  .from("beneficiaries")
                  .update({ status: "Sponsorship Cancelled" })
                  .eq("id", subscriptionData.beneficiary_id)

                if (statusUpdateError) {
                  console.error("Error updating beneficiary status:", statusUpdateError)
                } else {
                  // Send email notification
                  try {
                    // Get customer email from Stripe customer object
                    let customerEmail: string | null = null
                    let customerName: string | null = null
                    if (subscription.customer) {
                      try {
                        const customer = await stripe.customers.retrieve(subscription.customer as string)
                        if (customer && !customer.deleted && typeof customer === 'object' && 'email' in customer) {
                          customerEmail = customer.email || null
                          customerName = customer.name || null
                        }
                      } catch (customerError) {
                        console.error("Error fetching customer from Stripe:", customerError)
                      }
                    }
                    const { sendSponsorshipCancellationNotificationEmail } = await import("@/utils/email")
                    await sendSponsorshipCancellationNotificationEmail(
                      beneficiary.name,
                      customerEmail,
                      customerName,
                      subscriptionData.amount
                    )
                  } catch (emailError) {
                    console.error("Error sending cancellation notification email:", emailError)
                  }
                }
              }
            }
          }
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
          // Check if this is an application subscription by querying our database
          const { data: subscriptionData } = await supabase
            .from("subscriptions")
            .select("id")
            .eq("stripe_subscription_id", subscriptionId)
            .maybeSingle()

          // Silently acknowledge non-application subscription invoices
          if (!subscriptionData) {
            if (DEBUG_MODE) {
              console.log('[DEBUG] Non-application invoice payment event - silently acknowledging')
            }
            return NextResponse.json({ received: true }, { status: 200 })
          }

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
              const { data: subscriptionData, error: subscriptionError } = await supabase
                .from("subscriptions")
                .select("beneficiary_id, user_id, amount")
                .eq("stripe_subscription_id", subscriptionId)
                .maybeSingle()

              if (subscriptionError) {
                console.error("Error fetching subscription:", subscriptionError)
              }

              if (subscriptionData?.beneficiary_id) {
                // Get beneficiary name
                const { data: beneficiaryData, error: beneficiaryError } = await supabase
                  .from("beneficiaries")
                  .select("name")
                  .eq("id", subscriptionData.beneficiary_id)
                  .maybeSingle()

                if (beneficiaryError) {
                  console.error("Error fetching beneficiary for payment confirmation:", beneficiaryError)
                }

                // Get customer email and name from invoice (available directly on invoice object)
                const customerEmail = invoice.customer_email || null
                const customerName = invoice.customer_name || null

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
                        customerName,
                        subscriptionData.beneficiary_id,
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
        if (DEBUG_MODE) {
          console.log(`[DEBUG] Unhandled event type: ${event.type}`)
        }
        // Silently acknowledge unhandled event types
        return NextResponse.json(
          { received: true },
          { status: 200 },
        )
    }
  } catch (error) {
    console.error("Detailed webhook error:", {
      error,
      eventType: event?.type,
      eventId: event?.id,
      message: error instanceof Error ? error.message : "Unknown error occurred",
      stack: error instanceof Error ? error.stack : undefined,
    })
    // Always return 200 to Stripe to prevent retries for unexpected errors
    // Log the error for investigation but don't fail the webhook
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
        received: true,
      },
      { status: 200 },
    )
  }
}
