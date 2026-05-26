import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/client"
import { notifySponsorshipReceived } from "@/services/telegram"
import { isPayPalEnabled, paypalFetch } from "@/lib/paypal/client"
import { sendSponsorshipCancellationNotificationEmail } from "@/utils/email"

async function getRawBody(req: Request): Promise<string> {
  const reader = req.body?.getReader()
  if (!reader) return ""
  let result = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result += new TextDecoder().decode(value)
  }
  return result
}

async function getPayPalPlanDetails(planId: string) {
  const response = await paypalFetch(`/v1/billing/plans/${planId}`, {
    method: "GET",
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error("PayPal plan fetch error:", errorText)
    throw new Error("Failed to fetch PayPal plan details")
  }

  return response.json()
}

export async function POST(req: Request) {
  if (!isPayPalEnabled()) {
    return NextResponse.json(
      { error: "PayPal integration is not enabled" },
      { status: 501 },
    )
  }

  const supabase = createClient()
  try {
    const rawBody = await getRawBody(req)

    const transmissionId = req.headers.get("paypal-transmission-id") || ""
    const transmissionTime = req.headers.get("paypal-transmission-time") || ""
    const certUrl = req.headers.get("paypal-cert-url") || ""
    const authAlgo = req.headers.get("paypal-auth-algo") || ""
    const transmissionSig = req.headers.get("paypal-transmission-sig") || ""
    const webhookId = process.env.PAYPAL_WEBHOOK_ID || ""

    const event = JSON.parse(rawBody)

    const verifyRes = await paypalFetch(
      "/v1/notifications/verify-webhook-signature",
      {
        method: "POST",
        body: JSON.stringify({
          auth_algo: authAlgo,
          cert_url: certUrl,
          transmission_id: transmissionId,
          transmission_sig: transmissionSig,
          transmission_time: transmissionTime,
          webhook_id: webhookId,
          webhook_event: event,
        }),
      },
    )

    const verifyData = await verifyRes.json()
    if (verifyData.verification_status !== "SUCCESS") {
      console.error("PayPal webhook signature verification failed:", verifyData)
      return NextResponse.json(
        { error: "Invalid webhook signature" },
        { status: 400 },
      )
    }

    switch (event.event_type) {
      case "PAYMENT.SALE.COMPLETED": {
        return NextResponse.json(
          { message: "PayPal payment processed successfully" },
          { status: 200 },
        )
      }
      case "PAYMENT.CAPTURE.COMPLETED": {
        return NextResponse.json(
          { message: "PayPal payment processed successfully" },
          { status: 200 },
        )
      }
      case "BILLING.SUBSCRIPTION.ACTIVATED": {
        const sub = event.resource
        const beneficiaryId = sub.custom_id || null
        const customerId = sub.subscriber?.payer_id || null
        const payerEmail = sub.subscriber?.email_address || null

        const payerName = sub.subscriber?.name
          ? `${sub.subscriber.name.given_name || ""} ${
              sub.subscriber.name.surname || ""
            }`.trim()
          : null
        const amount = sub.billing_info?.last_payment?.amount?.value
          ? Math.round(
              parseFloat(sub.billing_info.last_payment.amount.value) * 100,
            )
          : null
        const recurringReference = sub.billing_agreement_id || sub.id

        const { data: beneficiary, error: beneficiaryError } = beneficiaryId
          ? await supabase
              .from("beneficiaries")
              .select("name")
              .eq("id", beneficiaryId)
              .single()
          : { data: null, error: null }
        const beneficiaryName =
          !beneficiaryError && beneficiary && beneficiary.name
            ? beneficiary.name
            : beneficiaryId

        const { error: transactionError } = await supabase
          .from("transaction_ledger")
          .insert({
            user_id: null,
            credit: amount,
            customer_email: payerEmail,
            customer_name: payerName,
            reference: recurringReference,
            description: `PayPal recurring sponsorship payment${beneficiaryName ? ` for beneficiary ${beneficiaryName}` : ""} with amount of ${amount}`,
            tx_action: "SPONSORSHIP",
            subscription_type: "subscription",
            beneficiary_id: /^[0-9a-fA-F-]{36}$/.test(beneficiaryId || "")
              ? beneficiaryId
              : null,
            created_at: new Date(),
            customer_id: customerId,
            payment_intent: null,
            payment_method_id: null,
          })

        if (transactionError) {
          console.error(
            "Error creating PayPal recurring transaction:",
            transactionError,
          )
          return NextResponse.json(
            { error: "Failed to create recurring transaction" },
            { status: 500 },
          )
        }

        try {
          await notifySponsorshipReceived({
            sponsorName: payerName || "Anonymous Sponsor",
            sponsorEmail: payerEmail || "No email provided",
            amount: amount || 0,
            beneficiaryId: beneficiaryId,
            beneficiaryName: beneficiaryName,
            paymentMethod: "PayPal",
            paymentReference: recurringReference,
          })
        } catch (telegramError) {
          console.error(
            "Failed to send PayPal sponsorship Telegram notification:",
            telegramError,
          )
        }

        return NextResponse.json(
          { message: "PayPal recurring payment processed successfully" },
          { status: 200 },
        )
      }

      case "BILLING.SUBSCRIPTION.CREATED": {
        const subscription = event.resource
        const paypalSubscriptionId = subscription.id
        const status = subscription.status
        const planId = subscription.plan_id
        const startTime = subscription.start_time
          ? new Date(subscription.start_time)
          : new Date()
        const subscriber = subscription.subscriber || {}
        const customerId = subscriber.payer_id || null
        const userId = null
        const beneficiaryId = subscription.custom_id || null

        const payerEmail = subscriber.email_address || null
        const payerName = subscriber.name
          ? `${subscriber.name.given_name || ""} ${
              subscriber.name.surname || ""
            }`.trim()
          : null

        const { data: beneficiary, error: beneficiaryError } = beneficiaryId
          ? await supabase
              .from("beneficiaries")
              .select("name")
              .eq("id", beneficiaryId)
              .single()
          : { data: null, error: null }
        const beneficiaryName =
          !beneficiaryError && beneficiary && beneficiary.name
            ? beneficiary.name
            : beneficiaryId

        let amount = null
        let interval = null
        try {
          if (planId) {
            const plan = await getPayPalPlanDetails(planId)
            type PayPalBillingCycle = {
              pricing_scheme?: {
                fixed_price: {
                  value: string
                }
              }
              frequency?: {
                interval_unit?: string
              }
            }
            const regularCycle = plan.billing_cycles?.find(
              (cycle: PayPalBillingCycle) =>
                cycle.pricing_scheme && cycle.frequency,
            )
            if (regularCycle) {
              amount = Math.round(
                parseFloat(regularCycle.pricing_scheme.fixed_price.value) * 100,
              )
              interval =
                regularCycle.frequency?.interval_unit?.toLowerCase() || null
            }
          }
        } catch (planError) {
          console.error("Error fetching PayPal plan details:", planError)
        }

        let mappedStatus = status
        if (status === "APPROVAL_PENDING" || status === "pending")
          mappedStatus = "incomplete"
        else if (status === "APPROVED") mappedStatus = "approved"
        else if (status === "ACTIVE") mappedStatus = "active"
        else if (status === "SUSPENDED") mappedStatus = "suspended"
        else if (status === "CANCELLED") mappedStatus = "cancelled"
        else if (status === "EXPIRED") mappedStatus = "expired"

        const { error: insertError } = await supabase
          .from("subscriptions")
          .insert({
            user_id: userId,
            stripe_subscription_id: paypalSubscriptionId,
            status: "incomplete",
            amount: amount ?? 0,
            interval: interval ?? undefined,
            current_period_start: startTime,
            current_period_end: null,
            canceled_at: null,
            customer_id: customerId,
            created_at: startTime,
            beneficiary_id: beneficiaryId,
            sponsorship_method: "PAYPAL",
          })

        if (insertError) {
          console.error("Error creating PayPal subscription:", insertError)
          return NextResponse.json(
            {
              error: "Failed to create PayPal subscription",
              details: insertError,
            },
            { status: 500 },
          )
        }

        if (mappedStatus === "active" || mappedStatus === "approved") {
          try {
            await notifySponsorshipReceived({
              sponsorName: payerName || "Anonymous Sponsor",
              sponsorEmail: payerEmail || "No email provided",
              amount: amount || 0,
              beneficiaryId: beneficiaryId,
              beneficiaryName: beneficiaryName,
              paymentMethod: "PayPal",
              paymentReference: paypalSubscriptionId,
            })
          } catch (telegramError) {
            console.error(
              "Failed to send PayPal subscription Telegram notification:",
              telegramError,
            )
          }
        }

        return NextResponse.json(
          { message: "PayPal subscription created" },
          { status: 200 },
        )
      }

      case "BILLING.SUBSCRIPTION.CANCELLED": {
        const subscription = event.resource
        const paypalSubscriptionId = subscription.id

        const { data: subscriptionData, error: fetchError } = await supabase
          .from("subscriptions")
          .select("beneficiary_id, amount, user_id")
          .eq("stripe_subscription_id", paypalSubscriptionId)
          .maybeSingle()

        if (fetchError) {
          console.error("Error fetching subscription:", fetchError)
        }

        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({
            status: "cancelled",
            canceled_at: new Date(),
          })
          .eq("stripe_subscription_id", paypalSubscriptionId)

        if (updateError) {
          console.error("Error cancelling PayPal subscription:", updateError)
          return NextResponse.json(
            { error: "Failed to cancel PayPal subscription" },
            { status: 500 },
          )
        }

        if (subscriptionData?.beneficiary_id) {
          const { data: activeSubscriptions, error: activeError } =
            await supabase
              .from("subscriptions")
              .select("id")
              .eq("beneficiary_id", subscriptionData.beneficiary_id)
              .eq("status", "complete")

          if (
            !activeError &&
            (!activeSubscriptions || activeSubscriptions.length === 0)
          ) {
            const { data: beneficiary, error: beneficiaryError } =
              await supabase
                .from("beneficiaries")
                .select("id, name, status")
                .eq("id", subscriptionData.beneficiary_id)
                .single()

            if (!beneficiaryError && beneficiary) {
              if (
                beneficiary.status !== "Draft" &&
                beneficiary.status !== "Archived"
              ) {
                const { error: statusUpdateError } = await supabase
                  .from("beneficiaries")
                  .update({ status: "Sponsorship Cancelled" })
                  .eq("id", subscriptionData.beneficiary_id)

                if (statusUpdateError) {
                  console.error(
                    "Error updating beneficiary status:",
                    statusUpdateError,
                  )
                } else {
                  try {
                    const subscriber = subscription.subscriber || {}
                    const customerEmail = subscriber.email_address || null
                    const customerName = subscriber.name
                      ? `${subscriber.name.given_name || ""} ${subscriber.name.surname || ""}`.trim()
                      : null
                    await sendSponsorshipCancellationNotificationEmail(
                      beneficiary.name,
                      customerEmail,
                      customerName,
                      subscriptionData.amount,
                    )
                  } catch (emailError) {
                    console.error(
                      "Error sending cancellation notification email:",
                      emailError,
                    )
                  }
                }
              }
            }
          }
        }

        return NextResponse.json(
          { message: "PayPal subscription cancelled" },
          { status: 200 },
        )
      }

      default:
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("Webhook Error:", error)
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 },
    )
  }
}
