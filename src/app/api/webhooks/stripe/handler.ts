import { NextResponse } from "next/server"
import Stripe from "stripe"
import {
  ALL_STRIPE_REGIONS,
  getStripeClient,
  getWebhookSecret,
  type StripeRegion,
} from "@/lib/stripe/config"
import { createServiceRoleClient } from "@/utils/supabase/server"
import {
  type CurrencyConversion,
  coerceSupportedCurrency,
  convertUsdCentsToCurrency,
  formatMoney,
  parsePaymentCurrencyMetadata,
  verifyCurrencyConversion,
} from "@/utils/currency"
import {
  sendSponsorshipConfirmationEmail,
  sendBlindSponsorshipConfirmationEmail,
  sendPaymentFailedEmail,
  sendMonthlyPaymentConfirmationEmail,
  sendManagerSponsorshipNotificationEmail,
  sendPartnershipConfirmationEmail,
  sendBudgetFulfilledRejectionEmail,
  sendSponsorshipCancellationNotificationEmail,
  type SponsorshipProvider,
} from "@/utils/email"
import { notifySponsorshipReceived } from "@/services/telegram"

// Resolve provider for downstream emails / telegram notifications from
// session or subscription metadata, defaulting to STRIPE. This handler only
// fires for Stripe events today, but reading metadata keeps the door open
// for routing tests and for a future shared webhook surface.
function resolveProvider(
  metadata: Stripe.Metadata | null | undefined,
): SponsorshipProvider {
  const raw = metadata?.provider?.toUpperCase()
  return raw === "PAYPAL" ? "PAYPAL" : "STRIPE"
}

function providerLabel(provider: SponsorshipProvider): string {
  return provider === "PAYPAL" ? "PayPal" : "Stripe"
}

function buildCurrencyReconciliationFailure(
  eventType: string,
  providerId: string | null | undefined,
  expected: CurrencyConversion | null,
  actualCurrency: string | null | undefined,
  actualAmountMinor: number | null | undefined,
) {
  console.error("PAYMENT_CURRENCY_RECONCILIATION_FAILED", {
    provider: "stripe",
    eventType,
    providerId,
    expected,
    actualCurrency,
    actualAmountMinor,
  })
  return NextResponse.json({ received: true }, { status: 200 })
}

function reconcileStripeCheckoutSession(
  session: Stripe.Checkout.Session,
): CurrencyConversion | null {
  const explicit = parsePaymentCurrencyMetadata(session.metadata)
  if (explicit) return explicit

  const legacyAmount = Number(session.metadata?.amount)
  if (
    session.currency?.toUpperCase() === "USD" &&
    Number.isFinite(legacyAmount)
  ) {
    return convertUsdCentsToCurrency(Math.round(legacyAmount), "USD")
  }

  return null
}

function validateStripeCurrencyAmount(
  conversion: CurrencyConversion | null,
  actualCurrency: string | null | undefined,
  actualAmountMinor: number | null | undefined,
): conversion is CurrencyConversion {
  return Boolean(
    conversion &&
      actualCurrency?.toUpperCase() === conversion.chargedCurrency &&
      actualAmountMinor === conversion.chargedAmountMinor &&
      verifyCurrencyConversion(conversion),
  )
}

export async function handleStripeWebhook(req: Request) {
  const supabase = createServiceRoleClient()
  const sig = req.headers.get("stripe-signature") as string
  const rawBody = await req.text()

  // Try each configured region's webhook secret. The Stripe account whose
  // signing secret matches determines the region for downstream API calls
  // (refunds, subscription lookups, etc.).
  let region: StripeRegion | undefined
  let event: Stripe.Event | undefined

  for (const candidate of ALL_STRIPE_REGIONS) {
    let secret: string
    try {
      secret = getWebhookSecret(candidate)
    } catch {
      continue // region not configured, skip
    }

    try {
      event = Stripe.webhooks.constructEvent(rawBody, sig, secret)
      region = candidate
      break
    } catch {
      continue // secret didn't match, try next
    }
  }

  if (!region || !event) {
    // None of our configured secrets matched — this event belongs to a
    // different webhook endpoint on the same shared Stripe account
    // (e.g. Donorbox payment_intent.succeeded events). Discard silently.
    console.warn("[webhook]", `event=${extractEventId(rawBody)} discarded — not ours`)
    return NextResponse.json({ received: true }, { status: 200 })
  }

  console.log("[webhook]", region, "event=" + event.id, "type=" + event.type)

  const stripe = getStripeClient(region)

  try {

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const type = session.metadata?.type
        const paymentType = session.metadata?.paymentType
        const customerEmail = session.customer_details?.email
        const interval = paymentType === "subscription" ? "month" : paymentType === "one_time" ? "one_time" : "year"

        // Platform-origin gate: only process sessions our Stripe route created.
        // Every session created through src/app/api/stripe/route.ts includes
        // creatorshare_platform: "true" in session metadata. Sessions from
        // other surfaces sharing this Stripe account are silently acknowledged.
        if (session.metadata?.creatorshare_platform !== "true") {
          return NextResponse.json(
            { received: true },
            { status: 200 },
          )
        }

        const { data: processedTransaction } = await supabase
          .from("transaction_ledger")
          .select("id")
          .eq("provider_event_id", event.id)
          .maybeSingle()

        if (processedTransaction) {
          return NextResponse.json(
            { message: "Transaction already processed" },
            { status: 200 },
          )
        }

        const conversion = reconcileStripeCheckoutSession(session)
        if (
          !validateStripeCurrencyAmount(
            conversion,
            session.currency,
            session.amount_total,
          )
        ) {
          return buildCurrencyReconciliationFailure(
            event.type,
            session.id,
            conversion,
            session.currency,
            session.amount_total,
          )
        }

        const amount = conversion.baseAmountUsdCents
        const currencyPersistence = {
          charged_amount: conversion.chargedAmountMinor,
          charged_currency: conversion.chargedCurrency,
          conversion_rate: conversion.conversionRate,
          provider_event_id: event.id,
        }

        if (type === "partnership") {
          const email = session.metadata?.email
          const project = session.metadata?.project

          if (!email || !amount || !project) {
            console.error(
              "[creatorshare] Partnership session missing required metadata:",
              session.metadata,
            )
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
            payment_region: region,
            ...currencyPersistence,
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
                payment_region: region,
                ...currencyPersistence,
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
          const partnershipReference =
            session.invoice?.toString() || session.id
          const { data: existingPartnershipTransaction } = await supabase
            .from("transaction_ledger")
            .select("id")
            .eq("provider_event_id", event.id)
            .maybeSingle()

          const { error: transactionError } = existingPartnershipTransaction
            ? { error: null }
            : await supabase
            .from("transaction_ledger")
            .insert({
              description: `Partnership payment for ${project} project with amount of ${formatMoney(conversion.chargedAmountMinor, conversion.chargedCurrency)}`,
              reference: partnershipReference,
              credit: amount,
              ...currencyPersistence,
              subscription_type:
                session.metadata?.paymentType === "one_time"
                  ? "one_time"
                  : "subscription",
              tx_action: "PARTNERSHIP",
              customer_name: session.customer_details?.name || null,
              customer_email: email || null,
              payment_region: region,
            })

          if (transactionError) {
            console.error("Error creating transaction:", transactionError)
          }

          // Send confirmation email for partnership
          if (email) {
            try {
              await sendPartnershipConfirmationEmail(
                email,
                project,
                amount,
                session.mode === "subscription" ? "month" : "year",
                session.customer_details?.name || null,
                {
                  provider: "STRIPE",
                  region,
                  chargedAmountMinor: conversion.chargedAmountMinor,
                  chargedCurrency: conversion.chargedCurrency,
                },
              )
            } catch (emailError) {
              console.error("Error sending partnership email:", emailError)
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
          console.error(
            "[creatorshare] Sponsorship session missing required metadata:",
            session.metadata,
          )
          return NextResponse.json(
            { received: true },
            { status: 200 },
          )
        }


        // Step 1: Insert subscription — trigger will validate atomically.
        //
        // One-time payments (mode === "payment") intentionally skip this
        // block: one-time gifts to open-sponsorship types (budget_goal = -1)
        // have no recurring period to track and should not contribute to the
        // monthly budget_raised metric. The tLedger entry and emails below
        // handle the one-time case instead.
        if (session.mode === "subscription" && session.subscription) {
          const { data: existingSubscription } = await supabase
            .from("subscriptions")
            .select("id")
            .eq("stripe_subscription_id", session.subscription as string)
            .maybeSingle()

          const { error: subscriptionError } = existingSubscription
            ? { error: null }
            : await supabase
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
              payment_region: region,
              ...currencyPersistence,
            })

          // Step 2: Handle subscription insert errors
          if (subscriptionError) {
            console.error("Subscription insert failed:", subscriptionError)
            
            // Check for beneficiary status rejection from trigger
            if (subscriptionError.message?.includes('beneficiary_not_accepting_subscriptions')) {
              
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
                  await stripe.refunds.create({
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
                  const emailResult = await sendBudgetFulfilledRejectionEmail(
                    customerEmail,
                    beneficiaryName,
                    amount,
                    session.customer_details?.name || null,
                    beneficiaryId,
                  )
                  
                  emailSent = emailResult.success
                } catch (emailError) {
                  console.error("Failed to send rejection email:", {
                    error: emailError,
                    customerEmail,
                    sessionId: session.id
                  })
                }
              }
              
              // Step 5: Final logging (errors only)
              if (!paymentRefunded || !subscriptionCancelled || !emailSent) {
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

        // Step 4: Create transaction ledger entry.
        // Runs for both subscription and one-time checkouts. For one-time
        // payments there is no subscription to roll back, so errors here
        // are logged but never fatal.
        // This is a separate operation - log error but don't rollback subscription
        const sponsorshipReference = session.invoice?.toString() || session.id
        const { data: existingSponsorshipTransaction } = await supabase
          .from("transaction_ledger")
          .select("id")
          .eq("provider_event_id", event.id)
          .maybeSingle()

        const { error: transactionError } = existingSponsorshipTransaction
          ? { error: null }
          : await supabase
          .from("transaction_ledger")
          .insert({
            beneficiary_id: beneficiaryId || null,
            user_id: userId,
            description: `Sponsorship to ${beneficiaryName} with amount of ${formatMoney(conversion.chargedAmountMinor, conversion.chargedCurrency)}`,
            reference: sponsorshipReference,
            credit: amount,
            ...currencyPersistence,
            subscription_type:
              session.metadata?.paymentType === "one_time"
                ? "one_time"
                : "subscription",
            tx_action: "SPONSORSHIP",
            customer_name: session.customer_details?.name || null,
            customer_email: customerEmail || null,
            payment_region: region,
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
            description: `Someone sponsored with ${formatMoney(
              conversion.chargedAmountMinor,
              conversion.chargedCurrency,
            )}/${interval}`,
            beneficiary_id: beneficiaryId || null,
            user_id: userId,
            // Sponsorship-completion activities are surfaced on the public
            // beneficiary feed (open sponsorship states feature). All other
            // activity types default to is_public=false at the DB level.
            is_public: true,
          })

        if (activityError) {
          console.error("Error creating activity:", activityError)
          // Continue - not critical
        }

        // ============================================================
        // STEP 6: Send confirmation emails
        // ============================================================
        // IMPORTANT: This code is only reached if subscription was successfully inserted
        // into the database (no errors in Step 1). If subscription insert failed:
        //   - beneficiary_not_accepting_subscriptions → rejection email sent, returned early (line 445)
        //   - other errors → thrown and caught in outer catch, no email sent
        // Therefore, confirmation emails are ONLY sent for successful sponsorships.
        // ============================================================
        // Send confirmation to sponsor if we have their email
        const sessionProvider = resolveProvider(session.metadata)
        if (customerEmail) {
          try {
            if (isBlindSponsorship) {
              await sendBlindSponsorshipConfirmationEmail(
                customerEmail,
                amount,
                interval,
                blindLabel,
                session.customer_details?.name || null,
                {
                  provider: sessionProvider,
                  region,
                  chargedAmountMinor: conversion.chargedAmountMinor,
                  chargedCurrency: conversion.chargedCurrency,
                },
              )
            } else {
              await sendSponsorshipConfirmationEmail(
                customerEmail,
                beneficiaryName,
                amount,
                interval,
                session.customer_details?.name || null,
                beneficiaryId || null,
                {
                  provider: sessionProvider,
                  region,
                  chargedAmountMinor: conversion.chargedAmountMinor,
                  chargedCurrency: conversion.chargedCurrency,
                },
              )
            }
          } catch (emailError) {
            console.error("Error in email sending process:", emailError)
          }
        }

        // Send notification to manager
        if (process.env.MANAGER_EMAIL) {
          try {
            await sendManagerSponsorshipNotificationEmail(
              beneficiaryName,
              amount,
              interval,
              customerEmail,
              session.customer_details?.name,
              beneficiaryId || null,
              {
                provider: sessionProvider,
                region,
                chargedAmountMinor: conversion.chargedAmountMinor,
                chargedCurrency: conversion.chargedCurrency,
              },
            )
          } catch (emailError) {
            console.error("Error sending manager notification:", emailError)
          }
        }

        // Send Telegram notification for sponsorship
        try {
          await notifySponsorshipReceived({
            sponsorName: session.customer_details?.name || customerEmail?.split('@')[0] || "Anonymous Sponsor",
            sponsorEmail: customerEmail || "No email provided",
            amount: conversion.chargedAmountMinor,
            chargedCurrency: conversion.chargedCurrency,
            beneficiaryId: beneficiaryId,
            beneficiaryName: beneficiaryName,
            paymentMethod: providerLabel(sessionProvider),
            paymentReference: session.id,
            interval: interval,
          });
        } catch (telegramError) {
          console.error('Telegram sponsorship notification failed:', telegramError);
          // Don't fail the webhook if Telegram notification fails
        }

        // Step 6: Auto-match blind sponsorships
        if (isBlindSponsorship && session.subscription) {
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
              await matchResponse.json()
            } else {
              const errorData = await matchResponse.json()
              console.error("Blind sponsorship auto-match failed:", {
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
          .select(`beneficiary_id, charged_amount, charged_currency, amount`)
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
            
            // invoice.metadata is not auto-populated from session or
            // subscription metadata, so reading provider from it is illusory.
            // Hardcode STRIPE here: this entire handler only fires for
            // Stripe events. A future PayPal webhook surface would call
            // sendPaymentFailedEmail with its own { provider: "PAYPAL" }.
            await sendPaymentFailedEmail(
              customerEmail,
              beneficiaryName,
              invoice.amount_due || subscriptionData?.amount || 0,
              invoice.next_payment_attempt
                ? new Date(invoice.next_payment_attempt * 1000)
                : null,
              customerName,
              subscriptionData?.beneficiary_id || null,
              {
                provider: "STRIPE",
                region,
                chargedAmountMinor:
                  invoice.amount_due || subscriptionData?.charged_amount,
                chargedCurrency:
                  invoice.currency?.toUpperCase() ||
                  subscriptionData?.charged_currency,
              },
            )
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

        // The metadata-type filter rejects random Stripe Connect / third-party
        // subscriptions, but it would also reject our own subscriptions that
        // were created before subscription_data.metadata started carrying a
        // `type` field. To avoid silently dropping cancellations from those
        // legacy rows, fall back to a DB lookup keyed on stripe_subscription_id
        // before bailing.
        const isKnownType = type === "partnership" || type === "sponsorship"
        if (!isKnownType) {
          const { data: knownSub } = await supabase
            .from("subscriptions")
            .select("id")
            .eq("stripe_subscription_id", subscription.id)
            .maybeSingle()

          if (!knownSub) {
            return NextResponse.json({ received: true }, { status: 200 })
          }
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

        // See customer.subscription.updated above: filter by metadata type but
        // fall back to a DB lookup so we never drop a cancellation for a
        // subscription we have on file. Resolve `type` from the DB row when
        // metadata is missing so the partnership/sponsorship branch below
        // still routes correctly.
        let resolvedType: "partnership" | "sponsorship" | null =
          type === "partnership" || type === "sponsorship" ? type : null

        if (!resolvedType) {
          const { data: knownSub } = await supabase
            .from("subscriptions")
            .select("id")
            .eq("stripe_subscription_id", subscription.id)
            .maybeSingle()

          if (!knownSub) {
            // Check partnerships too (email-keyed), then bail if neither matches.
            const email = subscription.metadata?.email
            if (email) {
              const { data: knownPartnership } = await supabase
                .from("partnerships")
                .select("id")
                .eq("email", email)
                .eq("status", "complete")
                .maybeSingle()
              if (knownPartnership) {
                resolvedType = "partnership"
              }
            }
            if (!resolvedType) {
              return NextResponse.json({ received: true }, { status: 200 })
            }
          } else {
            resolvedType = "sponsorship"
          }
        }

        if (resolvedType === "partnership") {
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
          console.error("Subscription cancellation update failed:", {
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
            .select("id, amount, charged_amount, charged_currency")
            .eq("stripe_subscription_id", subscriptionId)
            .maybeSingle()

          // Silently acknowledge non-application subscription invoices
          if (!subscriptionData) {
            return NextResponse.json({ received: true }, { status: 200 })
          }

          if (
            subscriptionData.charged_currency &&
            invoice.currency?.toUpperCase() !==
              subscriptionData.charged_currency
          ) {
            return buildCurrencyReconciliationFailure(
              event.type,
              invoice.id,
              {
                baseAmountUsdCents: subscriptionData.amount || 0,
                chargedAmountMinor: subscriptionData.charged_amount || 0,
                chargedCurrency: coerceSupportedCurrency(
                  subscriptionData.charged_currency,
                ),
                conversionRate: 1,
              },
              invoice.currency,
              invoice.amount_paid,
            )
          }

          if (
            typeof subscriptionData.charged_amount === "number" &&
            invoice.amount_paid !== subscriptionData.charged_amount
          ) {
            return buildCurrencyReconciliationFailure(
              event.type,
              invoice.id,
              {
                baseAmountUsdCents: subscriptionData.amount || 0,
                chargedAmountMinor: subscriptionData.charged_amount,
                chargedCurrency: coerceSupportedCurrency(
                  subscriptionData.charged_currency,
                ),
                conversionRate: 1,
              },
              invoice.currency,
              invoice.amount_paid,
            )
          }

          // Update subscription status
          await supabase
            .from("subscriptions")
            .update({ status: "complete" })
            .eq("stripe_subscription_id", subscriptionId)

          // Send monthly payment confirmation email
          // Only send for recurring payments, not for initial subscription creation
          // subscription_cycle = regular recurring payment
          // subscription_update = subscription was updated (amount, items, etc.)
          // subscription_create = first payment (already handled by checkout.session.completed)
          if (invoice.billing_reason === "subscription_cycle" || invoice.billing_reason === "subscription_update") {
            try {
              // Get subscription details to find beneficiary and customer email
              const { data: subscriptionData, error: subscriptionError } = await supabase
                .from("subscriptions")
                .select("beneficiary_id, user_id, amount, charged_amount, charged_currency")
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
                    // See note on sendPaymentFailedEmail above: invoice
                    // metadata is empty by default, so hardcode STRIPE.
                    await sendMonthlyPaymentConfirmationEmail(
                        customerEmail,
                        beneficiaryData.name,
                        subscriptionData.amount,
                        customerName,
                        subscriptionData.beneficiary_id,
                        {
                          provider: "STRIPE",
                          region,
                          chargedAmountMinor: invoice.amount_paid,
                          chargedCurrency:
                            invoice.currency?.toUpperCase() ||
                            subscriptionData.charged_currency,
                        },
                      )
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
        // Silently acknowledge unhandled event types
        return NextResponse.json(
          { received: true },
          { status: 200 },
        )
    }
  } catch (error) {
    console.warn("[webhook]", region, event?.id || "?", "error=", error instanceof Error ? error.message : String(error))
    // Always return 200 to Stripe to prevent retries for unexpected errors
    return NextResponse.json({ received: true }, { status: 200 })
  }
}

// Extract the event id from raw JSON payload without parsing the full body.
function extractEventId(rawBody: string): string | undefined {
  return rawBody.match(/"id"\s*:\s*"(evt_[^"]+)"/)?.[1]
}
