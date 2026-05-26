import { NextResponse } from "next/server"
import { isPayPalEnabled, paypalFetch } from "@/lib/paypal/client"
import { createClient } from "@/utils/supabase/server"
import {
  convertCurrencyMinorToUsdCents,
  convertUsdCentsToCurrency,
  verifyCurrencyConversion,
} from "@/utils/currency"
import { parsePayPalPaymentContext } from "@/utils/paypalCurrencyContext"

function parsePayPalAmountMinor(value: string | undefined, minorUnit: number) {
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.round(amount * 10 ** minorUnit) : null
}

export async function GET(req: Request) {
  if (!isPayPalEnabled()) {
    return NextResponse.json(
      { error: "PayPal integration is not enabled" },
      { status: 501 },
    )
  }

  const { searchParams } = new URL(req.url)
  const sponsorshipId = searchParams.get("sponsorship_id")
  const token = searchParams.get("token")

  if (!sponsorshipId && !token) {
    return NextResponse.json(
      { error: "Missing sponsorship_id or token" },
      { status: 400 },
    )
  }

  try {
    if (sponsorshipId) {
      const supabase = await createClient()

      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }

      const { data: subscription, error: subscriptionError } = await supabase
        .from("subscriptions")
        .select(
          `
          *,
          beneficiaries (
            name,
            location_str
          )
        `,
        )
        .eq("stripe_subscription_id", sponsorshipId)
        .single()

      if (subscription && !subscriptionError) {
        return NextResponse.json({ subscription })
      }

      try {
        const res = await paypalFetch(
          `/v1/billing/subscriptions/${sponsorshipId}`,
          { method: "GET" },
        )

        const paypalData = await res.json()
        if (!res.ok) {
          console.error("PayPal subscription fetch failed:", paypalData)
          return NextResponse.json(
            { error: "PayPal subscription not found" },
            { status: 404 },
          )
        }

        const paymentContext = parsePayPalPaymentContext(paypalData.custom_id)
        const beneficiaryId = paymentContext.beneficiaryId
        let beneficiaryData = null
        if (beneficiaryId) {
          const { data: beneficiary } = await supabase
            .from("beneficiaries")
            .select("name, location_str")
            .eq("id", beneficiaryId)
            .single()

          if (beneficiary) {
            beneficiaryData = beneficiary
          }
        }

        if (paypalData.status === "ACTIVE") {
          const lastPaymentAmount = paypalData.billing_info?.last_payment?.amount
          const conversion =
            paymentContext.conversion ||
            convertUsdCentsToCurrency(
              convertCurrencyMinorToUsdCents(
                parsePayPalAmountMinor(lastPaymentAmount?.value, 2) || 0,
                lastPaymentAmount?.currency_code || "USD",
              ),
              lastPaymentAmount?.currency_code || "USD",
            )
          const actualAmountMinor = parsePayPalAmountMinor(
            lastPaymentAmount?.value,
            conversion.chargedCurrencyMinorUnit,
          )
          if (
            lastPaymentAmount?.currency_code?.toUpperCase() !==
              conversion.chargedCurrency ||
            actualAmountMinor !== conversion.chargedAmountMinor ||
            !verifyCurrencyConversion(conversion)
          ) {
            console.error("PAYMENT_CURRENCY_RECONCILIATION_FAILED", {
              provider: "paypal",
              paypalSubscriptionId: paypalData.id,
              expected: conversion,
              actualCurrency: lastPaymentAmount?.currency_code,
              actualAmount: lastPaymentAmount?.value,
            })
            return NextResponse.json(
              { error: "Payment currency reconciliation failed" },
              { status: 409 },
            )
          }

          const { data: existingSubscription } = await supabase
            .from("subscriptions")
            .select(
              `
              *,
              beneficiaries (
                name,
                location_str
              )
            `,
            )
            .eq("stripe_subscription_id", paypalData.id)
            .maybeSingle()

          if (existingSubscription) {
            return NextResponse.json({
              subscription: {
                ...existingSubscription,
                beneficiaries:
                  existingSubscription.beneficiaries || beneficiaryData,
                status: paypalData.status?.toLowerCase(),
              },
              paypal_order: null,
            })
          }

          const { data: newSubscription, error: createError } = await supabase
            .from("subscriptions")
            .insert({
              stripe_subscription_id: paypalData.id,
              beneficiary_id: beneficiaryId,
              user_id: user.id,
              customer_id: paypalData.subscriber.payer_id,
              sponsorship_method: "PAYPAL",
              amount: conversion.baseAmountUsdCents,
              charged_amount: conversion.chargedAmountMinor,
              charged_currency: conversion.chargedCurrency,
              charged_currency_minor_unit:
                conversion.chargedCurrencyMinorUnit,
              conversion_rate: conversion.conversionRate,
              conversion_rate_source: conversion.conversionRateSource,
              currency_config_version: conversion.currencyConfigVersion,
              interval: "month",
              status: "complete",
              current_period_start:
                paypalData.billing_info?.last_payment?.time ||
                paypalData.create_time,
              current_period_end: paypalData.billing_info?.next_billing_time,
              created_at: paypalData.create_time,
            })
            .select()
            .single()

          if (createError) {
            console.error("Failed to create subscription record:", createError)
          } else {
            return NextResponse.json({
              subscription: {
                ...newSubscription,
                beneficiaries: beneficiaryData,
                status: paypalData.status?.toLowerCase(),
              },
              paypal_order: null,
            })
          }
        }

        return NextResponse.json({
          subscription: {
            ...paypalData,
            beneficiaries: beneficiaryData,
            status: paypalData.status?.toLowerCase() || "incomplete",
          },
          paypal_order: null,
        })
      } catch (paypalError) {
        console.error("PayPal API error:", paypalError)
        return NextResponse.json(
          { error: "Failed to fetch subscription details" },
          { status: 500 },
        )
      }
    }

    if (token) {
      const res = await paypalFetch(`/v2/checkout/orders/${token}`, {
        method: "GET",
      })

      const data = await res.json()
      if (!res.ok) {
        return NextResponse.json({ error: data }, { status: 400 })
      }
      return NextResponse.json(data)
    }
  } catch (error) {
    console.error("PayPal verify error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
