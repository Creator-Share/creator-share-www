import { NextResponse } from "next/server"
import { isPayPalEnabled, paypalFetch } from "@/lib/paypal/client"

interface PayPalError {
  message?: string
  error?: {
    message?: string
  }
}

interface PayPalOrderData {
  id: string
  status: string
}

interface PayPalCaptureData extends PayPalOrderData {
  purchase_units: Array<{
    payments?: {
      captures?: Array<{
        id: string
        status: string
      }>
    }
  }>
}

async function createPayPalOrder(amount: number, beneficiaryId?: string) {
  const response = await paypalFetch("/v2/checkout/orders", {
    method: "POST",
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: beneficiaryId || undefined,
          custom_id: beneficiaryId || undefined,
          amount: {
            currency_code: "USD",
            value: amount.toFixed(2),
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
      orderID,
      plan_id,
      subscriber_email,
      subscriber_name,
    } = body

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
          custom_id: beneficiaryId || undefined,
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
            return_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/success?sponsorship_id=${beneficiaryId}`,
            cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/payments/failed`,
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

        if (orderData.status === "COMPLETED") {
          return NextResponse.json({
            success: true,
            message: "Payment already captured",
            data: {
              beneficiaryId,
              beneficiaryName,
              amount,
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

        return NextResponse.json({
          success: true,
          message: "Payment captured successfully",
          data: {
            beneficiaryId,
            beneficiaryName,
            amount,
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

    const orderData = await createPayPalOrder(amount, beneficiaryId)

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
