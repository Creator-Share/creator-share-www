import { NextResponse } from "next/server"

const PAYPAL_API_URL = "https://api-m.sandbox.paypal.com"

async function getPayPalAccessToken() {
  try {
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
      console.error("PayPal credentials missing")
      throw new Error("PayPal credentials not configured")
    }

    const auth = Buffer.from(
      `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
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

    const data = await response.json()
    if (!data.access_token) {
      throw new Error("Invalid PayPal token response")
    }

    return data.access_token
  } catch (error) {
    console.error("Error getting PayPal access token:", error)
    throw error
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get("id")

    if (!orderId) {
      return NextResponse.json(
        { error: "Order ID is required", code: "ORDER_ID_REQUIRED" },
        { status: 400 },
      )
    }

    const accessToken = await getPayPalAccessToken()

    const response = await fetch(
      `${PAYPAL_API_URL}/v2/checkout/orders/${orderId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    )

    if (!response.ok) {
      const errorData = await response.json()
      console.error("PayPal order fetch error:", errorData)
      return NextResponse.json(
        { error: "Failed to fetch order details", code: "ORDER_NOT_FOUND" },
        { status: 404 },
      )
    }

    const orderData = await response.json()

    // Format the response to match the structure expected by the success page
    const formattedResponse = {
      session: {
        metadata: {
          type: "sponsorship",
          childName:
            orderData.purchase_units[0]?.description?.split(" for ")[1] ||
            "your sponsored child",
          childLocation:
            orderData.purchase_units[0]?.shipping?.address?.country_code || "",
          amount: (
            parseFloat(orderData.purchase_units[0]?.amount?.value || "0") * 100
          ).toString(),
          paymentType: orderData.purchase_units[0]?.description?.includes(
            "Monthly",
          )
            ? "subscription"
            : "yearly",
        },
        customer_details: {
          email: orderData.payer?.email_address || "",
        },
      },
    }

    return NextResponse.json(formattedResponse)
  } catch (error) {
    console.error("Error fetching PayPal order:", error)
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 },
    )
  }
}
