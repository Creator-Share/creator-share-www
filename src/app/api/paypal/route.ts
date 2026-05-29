import { NextResponse } from "next/server"
import { isPayPalEnabled, paypalFetch } from "@/lib/paypal/client"
import { createServiceRoleClient } from "@/utils/supabase/server"
import {
  coerceSupportedCurrency,
  convertUsdCentsToCurrency,
  dollarsToCents,
  centsToDollars,
  formatMoney,
  verifyCurrencyConversion,
} from "@/utils/currency"
import {
  encodePayPalPaymentContext,
  parsePayPalPaymentContext,
} from "@/utils/paypalCurrencyContext"

interface PayPalError {
  message?: string
  error?: {
    message?: string
  }
}

interface PayPalOrderData {
  id: string
  status: string
  payer?: {
    email_address?: string
    payer_id?: string
    name?: {
      given_name?: string
      surname?: string
    }
  }
  purchase_units?: Array<{
    custom_id?: string
    amount?: {
      value?: string
      currency_code?: string
    }
  }>
}

interface PayPalCaptureData {
  id: string
  status: string
  purchase_units: Array<{
    payments?: {
      captures?: Array<{
        id: string
        status: string
        amount?: {
          value?: string
          currency_code?: string
        }
      }>
    }
  }>
}

function parsePayPalAmountMinor(value: string | undefined) {
  const val = Number(value)
  return Number.isFinite(val) ? Number(dollarsToCents(val)) : null
}

function toMajorAmountString(amountMinor: number) {
  return (amountMinor / 100).toFixed(2)
}

async function persistPayPalOneTimeTransaction({
  orderId,
  captureId,
  beneficiaryId,
  beneficiaryName,
  userId,
  sponsorEmail,
  payer,
  conversion,
}: {
  orderId: string
  captureId: string | null | undefined
  beneficiaryId: string | null | undefined
  beneficiaryName: string | null | undefined
  userId: string | null | undefined
  sponsorEmail: string | null | undefined
  payer: PayPalOrderData["payer"] | undefined
  conversion: ReturnType<typeof convertUsdCentsToCurrency>
}) {
  const supabase = createServiceRoleClient()
  const providerEventId = captureId || orderId
  const { data: existingByEvent } = await supabase
    .from("transaction_ledger")
    .select("id")
    .eq("provider_event_id", providerEventId)
    .maybeSingle()

  if (existingByEvent) return

  const { data: existingByReference } = await supabase
    .from("transaction_ledger")
    .select("id")
    .eq("reference", orderId)
    .eq("tx_action", "SPONSORSHIP")
    .maybeSingle()

  if (existingByReference) return

  const payerName = payer?.name
    ? `${payer.name.given_name || ""} ${payer.name.surname || ""}`.trim()
    : null
  const payerEmail = payer?.email_address || sponsorEmail || null
  const { error } = await supabase.from("transaction_ledger").insert({
    beneficiary_id: /^[0-9a-fA-F-]{36}$/.test(beneficiaryId || "")
      ? beneficiaryId
      : null,
    user_id: userId || null,
    description: `PayPal one-time sponsorship to ${beneficiaryName || beneficiaryId || "Unknown Beneficiary"} with amount of ${formatMoney(conversion.chargedAmountMinor, conversion.chargedCurrency)}`,
    reference: orderId,
    credit: conversion.baseAmountUsdCents,
    charged_amount: conversion.chargedAmountMinor,
    charged_currency: conversion.chargedCurrency,
    conversion_rate: conversion.conversionRate,
    provider_event_id: providerEventId,
    subscription_type: "one_time",
    tx_action: "SPONSORSHIP",
    customer_name: payerName,
    customer_email: payerEmail,
    customer_id: payer?.payer_id || null,
    payment_intent: captureId || null,
    payment_method_id: null,
  })

  if (error) {
    console.error("Error creating PayPal approval transaction:", error)
    throw new Error("Failed to record PayPal transaction")
  }
}

async function createPayPalOrder(
  baseAmountUsdCents: number,
  currencyCode: string | null | undefined,
  beneficiaryId?: string,
) {
  const conversion = convertUsdCentsToCurrency(
    baseAmountUsdCents,
    coerceSupportedCurrency(currencyCode),
  )
  const response = await paypalFetch("/v2/checkout/orders", {
    method: "POST",
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: beneficiaryId || undefined,
          custom_id: encodePayPalPaymentContext(
            beneficiaryId || null,
            conversion,
          ),
          amount: {
            currency_code: conversion.chargedCurrency,
            value: toMajorAmountString(
              conversion.chargedAmountMinor,
            ),
          },
        },
      ],
    }),
  })

  const responseText = await response.text()
  let data: PayPalOrderData
  try {
    const parsedData = responseText ? JSON.parse(responseText) : null
    if (!parsedData || !parsedData.id || !parsedData.status) {
      console.error("Invalid PayPal response:", parsedData)
      throw new Error("Invalid response format from PayPal")
    }
    data = parsedData
  } catch {
    console.error("Error parsing PayPal response:", responseText)
    throw new Error("Invalid response from PayPal")
  }

  if (!response.ok) {
    const errorData = data as unknown as PayPalError
    console.error("PayPal order creation error:", errorData)
    throw new Error(
      errorData.message ||
        errorData.error?.message ||
        "Failed to create PayPal order",
    )
  }

  return data
}

async function capturePayPalOrder(orderID: string) {
  const response = await paypalFetch(`/v2/checkout/orders/${orderID}/capture`, {
    method: "POST",
  })

  const responseText = await response.text()
  let data: PayPalCaptureData
  try {
    const parsedData = responseText ? JSON.parse(responseText) : null
    if (!parsedData || !parsedData.id || !parsedData.status) {
      console.error("Invalid PayPal response:", parsedData)
      throw new Error("Invalid response format from PayPal")
    }
    data = parsedData
  } catch {
    console.error("Error parsing PayPal response:", responseText)
    throw new Error("Invalid response from PayPal")
  }

  if (!response.ok) {
    const errorData = data as unknown as PayPalError
    console.error("PayPal capture error:", errorData)
    throw new Error(
      errorData.message ||
        errorData.error?.message ||
        "Failed to capture PayPal order",
    )
  }

  return data
}

export async function POST(request: Request) {
  if (!isPayPalEnabled()) {
    return NextResponse.json(
      { error: "PayPal integration is not enabled" },
      { status: 501 },
    )
  }

  try {
    const body = await request.json()

    const {
      beneficiaryId,
      beneficiaryName,
      amount,
      base_amount_usd_cents,
      currency_code,
      orderID,
      plan_id,
      userId,
      email,
      subscriber_email,
      subscriber_name,
    } = body

    const baseAmountUsdCents = Number.isFinite(Number(base_amount_usd_cents))
      ? Math.round(Number(base_amount_usd_cents))
      : Math.round(Number(amount || 0) * 100)
    const requestedCurrency = coerceSupportedCurrency(currency_code)
    const conversion = convertUsdCentsToCurrency(
      baseAmountUsdCents,
      requestedCurrency,
    )

    // If creating a subscription
    if (plan_id) {
      try {
        type PayPalSubscriber = {
          email_address?: string
          name?: {
            given_name: string
            surname: string
          }
        }
        const subscriber: PayPalSubscriber = {}
        if (subscriber_email) subscriber.email_address = subscriber_email
        if (subscriber_name) {
          const [given_name, ...surnameArr] = subscriber_name.split(" ")
          subscriber.name = {
            given_name,
            surname: surnameArr.join(" ") || "",
          }
        }

        const subscriptionPayload = {
          plan_id,
          custom_id: encodePayPalPaymentContext(
            beneficiaryId || null,
            conversion,
          ),
          subscriber,
          application_context: {
            brand_name: "Creator Share",
            locale: "en-US",
            shipping_preference: "NO_SHIPPING",
            user_action: "SUBSCRIBE_NOW",
            payment_method: {
              payer_selected: "PAYPAL",
              payee_preferred: "IMMEDIATE_PAYMENT_REQUIRED",
            },
            return_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?sponsorship_id=${beneficiaryId}&currency=${conversion.chargedCurrency}`,
            cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/failed?currency=${conversion.chargedCurrency}`,
          },
        }

        const response = await paypalFetch("/v1/billing/subscriptions", {
          method: "POST",
          body: JSON.stringify(subscriptionPayload),
        })

        const data = await response.json()

        if (!response.ok) {
          console.error("PayPal subscription creation error:", data)
          return NextResponse.json(
            {
              error: data,
              message: `PayPal API Error: ${data.message || "Unknown error"}`,
              details: data.details || null,
            },
            { status: 400 },
          )
        }
        return NextResponse.json({ subscription: data })
      } catch (subscriptionError) {
        console.error("Error creating PayPal subscription:", subscriptionError)
        return NextResponse.json(
          {
            error:
              subscriptionError instanceof Error
                ? subscriptionError.message
                : "Subscription creation failed",
            details: subscriptionError,
          },
          { status: 500 },
        )
      }
    }

    if (orderID) {
      try {
        const orderResponse = await paypalFetch(
          `/v2/checkout/orders/${orderID}`,
          { method: "GET" },
        )

        if (!orderResponse.ok) {
          const errorText = await orderResponse.text()
          console.error("PayPal order status error:", errorText)
          throw new Error("Failed to check order status")
        }

        const orderData = (await orderResponse.json()) as PayPalOrderData
        if (!orderData.status) {
          console.error("Invalid order data:", orderData)
          throw new Error("Invalid order status response")
        }

        const purchaseUnit = orderData.purchase_units?.[0]
        const orderContext = parsePayPalPaymentContext(purchaseUnit?.custom_id)
        const orderConversion =
          orderContext.conversion ||
          convertUsdCentsToCurrency(baseAmountUsdCents, requestedCurrency)
        const orderCurrency = coerceSupportedCurrency(
          purchaseUnit?.amount?.currency_code,
        )
        const orderAmountMinor = parsePayPalAmountMinor(
          purchaseUnit?.amount?.value,
        )
        if (
          orderCurrency !== orderConversion.chargedCurrency ||
          orderAmountMinor !== orderConversion.chargedAmountMinor ||
          !verifyCurrencyConversion(orderConversion)
        ) {
          console.error("PAYMENT_CURRENCY_RECONCILIATION_FAILED", {
            provider: "paypal",
            orderID,
            expected: orderConversion,
            actualCurrency: purchaseUnit?.amount?.currency_code,
            actualAmount: purchaseUnit?.amount?.value,
          })
          return NextResponse.json({
            success: false,
            message: "Payment currency reconciliation failed",
            acknowledged: true,
          })
        }

        if (orderData.status === "COMPLETED") {
          await persistPayPalOneTimeTransaction({
            orderId: orderID,
            captureId: orderID,
            beneficiaryId: orderContext.beneficiaryId || beneficiaryId,
            beneficiaryName,
            userId,
            sponsorEmail: email,
            payer: orderData.payer,
            conversion: orderConversion,
          })
          return NextResponse.json({
            success: true,
            message: "Payment already captured",
            data: {
              beneficiaryId: orderContext.beneficiaryId || beneficiaryId,
              beneficiaryName,
              amount: orderConversion.baseAmountUsdCents,
              chargedAmount: orderConversion.chargedAmountMinor,
              chargedCurrency: orderConversion.chargedCurrency,
              orderID,
              captureStatus: orderData.status,
            },
          })
        }

        const captureData = await capturePayPalOrder(orderID)

        if (captureData.status !== "COMPLETED") {
          return NextResponse.json(
            {
              error: `Payment capture failed with status: ${captureData.status}`,
            },
            { status: 400 },
          )
        }

        const capture = captureData.purchase_units?.[0]?.payments?.captures?.[0]
        const captureCurrency = coerceSupportedCurrency(capture?.amount?.currency_code)
        const captureAmountMinor = parsePayPalAmountMinor(
          capture?.amount?.value,
        )
        if (
          captureCurrency !== orderConversion.chargedCurrency ||
          captureAmountMinor !== orderConversion.chargedAmountMinor
        ) {
          console.error("PAYMENT_CURRENCY_RECONCILIATION_FAILED", {
            provider: "paypal",
            orderID,
            captureId: capture?.id,
            expected: orderConversion,
            actualCurrency: capture?.amount?.currency_code,
            actualAmount: capture?.amount?.value,
          })
          return NextResponse.json({
            success: false,
            message: "Payment currency reconciliation failed",
            acknowledged: true,
          })
        }

        await persistPayPalOneTimeTransaction({
          orderId: orderID,
          captureId: capture?.id || captureData.id,
          beneficiaryId: orderContext.beneficiaryId || beneficiaryId,
          beneficiaryName,
          userId,
          sponsorEmail: email,
          payer: orderData.payer,
          conversion: orderConversion,
        })

        return NextResponse.json({
          success: true,
          message: "Payment captured successfully",
          data: {
            beneficiaryId: orderContext.beneficiaryId || beneficiaryId,
            beneficiaryName,
            amount: orderConversion.baseAmountUsdCents,
            chargedAmount: orderConversion.chargedAmountMinor,
            chargedCurrency: orderConversion.chargedCurrency,
            chargedDisplay: formatMoney(
              orderConversion.chargedAmountMinor,
              orderConversion.chargedCurrency,
            ),
            orderID,
            captureID: captureData.id,
            captureStatus: captureData.status,
          },
        })
      } catch (error: unknown) {
        console.error("Error processing PayPal capture:", error)
        const errorMessage =
          error instanceof Error ? error.message : "Failed to process payment"
        return NextResponse.json({ error: errorMessage }, { status: 400 })
      }
    }

    const orderData = await createPayPalOrder(
      baseAmountUsdCents,
      requestedCurrency,
      beneficiaryId,
    )

    if (orderData.status !== "CREATED") {
      return NextResponse.json(
        { error: `Order creation failed with status: ${orderData.status}` },
        { status: 400 },
      )
    }

    return NextResponse.json({
      orderID: orderData.id,
      status: orderData.status,
    })
  } catch (error: unknown) {
    console.error("PayPal API Error:", error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    )
  }
}

export async function GET() {
  if (!isPayPalEnabled()) {
    return NextResponse.json(
      { error: "PayPal integration is not enabled" },
      { status: 501 },
    )
  }
  return NextResponse.json({ message: "PayPal API endpoint" }, { status: 200 })
}
