import { NextResponse } from "next/server"

const PAYPAL_API_URL =
  process.env.PAYPAL_API_URL || "https://api-m.sandbox.paypal.com"

async function getPayPalAccessToken() {
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

  const data = await response.json()
  return data.access_token
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const subscriptionId = searchParams.get("sponsorship_id")
  const token = searchParams.get("token")

  if (!subscriptionId && !token) {
    return NextResponse.json(
      { error: "Missing sponsorship_id or token" },
      { status: 400 },
    )
  }

  try {
    const accessToken = await getPayPalAccessToken()

    // Prefer sponsorship_id, fallback to token (order id)
    if (subscriptionId) {
      // Fetch subscription details
      const res = await fetch(
        `${PAYPAL_API_URL}/v1/billing/subscriptions/${subscriptionId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        },
      )

      const data = await res.json()
      if (!res.ok) {
        return NextResponse.json({ error: data }, { status: 400 })
      }
      // If custom_id is present, fetch beneficiary name from DB
      let beneficiaryName: string | undefined = undefined
      if (data.custom_id) {
        const { createClient } = await import("@/utils/supabase/client")
        const supabase = createClient()
        const { data: beneficiary, error } = await supabase
          .from("beneficiaries")
          .select("name")
          .eq("id", data.custom_id)
          .single()
        if (!error && beneficiary && beneficiary.name) {
          beneficiaryName = beneficiary.name
        }
      }
      return NextResponse.json({
        ...data,
        beneficiary_name: beneficiaryName,
      })
    } else if (token) {
      // Fetch order details
      const res = await fetch(`${PAYPAL_API_URL}/v2/checkout/orders/${token}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
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
