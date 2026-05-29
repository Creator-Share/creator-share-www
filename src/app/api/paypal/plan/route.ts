import { NextResponse } from "next/server"
import { isPayPalEnabled, paypalFetch } from "@/lib/paypal/client"
import {
  coerceSupportedCurrency,
  convertUsdCentsToCurrency,
} from "@/utils/currency"

function toMajorAmountString(amountMinor: number) {
  return (amountMinor / 100).toFixed(2)
}

async function createPayPalProduct(name: string, description: string) {
  const response = await paypalFetch("/v1/catalogs/products", {
    method: "POST",
    body: JSON.stringify({
      name,
      description,
      type: "SERVICE",
      category: "CHARITY",
    }),
  })

  if (response.ok) {
    const data = await response.json()
    return data.id as string
  }
  const data = await response.json()
  throw new Error(data?.message || "Failed to create PayPal product")
}

export async function POST(request: Request) {
  if (!isPayPalEnabled()) {
    return NextResponse.json(
      { error: "PayPal integration is not enabled" },
      { status: 501 },
    )
  }

  try {
    const {
      name,
      description,
      amount,
      base_amount_usd_cents,
      interval_unit,
      interval_count = 1,
      currency_code = "USD",
    } = await request.json()
    const baseAmountUsdCents = Number.isFinite(Number(base_amount_usd_cents))
      ? Math.round(Number(base_amount_usd_cents))
      : Math.round(Number(amount || 0) * 100)
    const conversion = convertUsdCentsToCurrency(
      baseAmountUsdCents,
      coerceSupportedCurrency(currency_code),
    )

    const product_id = await createPayPalProduct(name, description)

    const response = await paypalFetch("/v1/billing/plans", {
      method: "POST",
      body: JSON.stringify({
        product_id,
        name,
        description,
        status: "ACTIVE",
        billing_cycles: [
          {
            frequency: {
              interval_unit,
              interval_count,
            },
            tenure_type: "REGULAR",
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: {
              fixed_price: {
                value: toMajorAmountString(
                  conversion.chargedAmountMinor,
                ),
                currency_code: conversion.chargedCurrency,
              },
            },
          },
        ],
        taxes: undefined,
        metadata: undefined,
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee_failure_action: "CONTINUE",
          payment_failure_threshold: 3,
        },
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error("PayPal plan creation error:", data)
      return NextResponse.json({ error: data }, { status: 400 })
    }

    return NextResponse.json({ plan: data })
  } catch (error) {
    console.error("Error creating PayPal plan:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
