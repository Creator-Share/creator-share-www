import { NextResponse } from "next/server"

// Check if PayPal is enabled by checking if client ID is configured
const isPayPalEnabled = !!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID

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

interface PayPalTokenResponse {
  access_token: string
}

const PAYPAL_API_URL =
  process.env.PAYPAL_API_URL || "https://api-m.sandbox.paypal.com"

async function getPayPalAccessToken() {
  try {
    const auth = Buffer.from(
      `${process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
    ).toString("base64")
    const response = await fetch(`${PAYPAL_API_URL}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("PayPal token error response:", errorText)
      throw new Error("Failed to get PayPal access token")
    }

    const data = (await response.json()) as PayPalTokenResponse
    if (!data.access_token) {
      throw new Error("Invalid PayPal token response")
    }

    return data.access_token
  } catch (error: unknown) {
    console.error("Error getting PayPal access token:", error)
    throw error instanceof Error
      ? error
      : new Error("Failed to get PayPal access token")
  }
}

async function createPayPalOrder(
  amount: number,
  accessToken: string,
  beneficiaryId?: string,
) {
  try {
    const response = await fetch(`${PAYPAL_API_URL}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
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

    let data: PayPalOrderData
    const responseText = await response.text()
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
  } catch (error: unknown) {
    console.error("Error creating PayPal order:", error)
    throw error instanceof Error
      ? error
      : new Error("Failed to create PayPal order")
  }
}

async function capturePayPalOrder(orderID: string, accessToken: string) {
  try {
    const response = await fetch(
      `${PAYPAL_API_URL}/v2/checkout/orders/${orderID}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    )

    let data: PayPalCaptureData
    const responseText = await response.text()
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
  } catch (error: unknown) {
    console.error("Error capturing PayPal order:", error)
    throw error instanceof Error
      ? error
      : new Error("Failed to capture PayPal order")
  }
}

export async function POST(request: Request) {
  if (!isPayPalEnabled) {
    return NextResponse.json(
      { error: 'PayPal integration is not enabled' },
      { status: 501 }
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

    const accessToken = await getPayPalAccessToken()

    // If creating a subscription
    if (plan_id) {
      try {
        // Build subscriber object per PayPal docs
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

        const response = await fetch(
          `${PAYPAL_API_URL}/v1/billing/subscriptions`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(subscriptionPayload),
          },
        )

        const data = await response.json()

        if (!response.ok) {
          console.error("PayPal subscription creation error:", data)
          return NextResponse.json({ 
            error: data,
            message: `PayPal API Error: ${data.message || 'Unknown error'}`,
            details: data.details || null
          }, { status: 400 })
        }
        return NextResponse.json({ subscription: data })
      } catch (subscriptionError) {
        console.error('Error creating PayPal subscription:', subscriptionError)
        return NextResponse.json({ 
          error: subscriptionError instanceof Error ? subscriptionError.message : 'Subscription creation failed',
          details: subscriptionError
        }, { status: 500 })
      }
    }
    
    // If orderID is present, this is a capture request
    if (orderID) {
      try {
        // First check the order status
        const orderResponse = await fetch(
          `${PAYPAL_API_URL}/v2/checkout/orders/${orderID}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          },
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

        // If order is already captured, return success
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

        // If not captured, attempt to capture
        const captureData = await capturePayPalOrder(orderID, accessToken)

        if (captureData.status !== "COMPLETED") {
          return NextResponse.json(
            {
              error: `Payment capture failed with status: ${captureData.status}`,
            },
            { status: 400 },
          )
        }

        // Here you would update your database with the payment information

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

    // If no orderID and no plan_id, this is an order creation request
    const orderData = await createPayPalOrder(
      amount,
      accessToken,
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
    console.error('PayPal API Error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 })
  }
}

export async function GET() {
  if (!isPayPalEnabled) {
    return NextResponse.json(
      { error: 'PayPal integration is not enabled' },
      { status: 501 }
    )
  }
  return NextResponse.json({ message: "PayPal API endpoint" }, { status: 200 })
}
