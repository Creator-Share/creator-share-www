import { NextResponse } from "next/server"

// Check if PayPal is enabled by checking if client ID is configured
const isPayPalEnabled = !!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID

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
  if (!isPayPalEnabled) {
    return NextResponse.json(
      { error: 'PayPal integration is not enabled' },
      { status: 501 }
    )
  }

  const { searchParams } = new URL(req.url)
  const sponsorshipId = searchParams.get("sponsorship_id")
  const token = searchParams.get("token")

  console.log("PayPal verify params:", { sponsorshipId, token })

  if (!sponsorshipId && !token) {
    return NextResponse.json(
      { error: "Missing sponsorship_id or token" },
      { status: 400 },
    )
  }

  try {
    const accessToken = await getPayPalAccessToken()

    // If we have a sponsorship_id (PayPal subscription ID), try database first, then PayPal API
    if (sponsorshipId) {
      const { createClient } = await import("@/utils/supabase/server")
      const supabase = await createClient()

      // Get authenticated user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
      
      // First try to find the subscription in the database
      const { data: subscription, error: subscriptionError } = await supabase
        .from("subscriptions")
        .select(`
          *,
          beneficiaries (
            name,
            location_str
          )
        `)
        .eq("stripe_subscription_id", sponsorshipId)
        .single()

      if (subscription && !subscriptionError) {
        console.log("Found subscription in database:", subscription)
        return NextResponse.json({
          subscription: subscription,
        })
      }

      // If not found in database, fetch from PayPal API (subscription might be pending approval)
      console.log("Subscription not found in database, fetching from PayPal API...")
      try {
        const res = await fetch(`${PAYPAL_API_URL}/v1/billing/subscriptions/${sponsorshipId}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        })

        const paypalData = await res.json()
        if (res.ok) {
          console.log("Found subscription in PayPal API:", paypalData)
          
          // Try to get beneficiary info from custom_id
          let beneficiaryData = null
          if (paypalData.custom_id) {
            const { data: beneficiary } = await supabase
              .from("beneficiaries")
              .select("name, location_str")
              .eq("id", paypalData.custom_id)
              .single()
            
            if (beneficiary) {
              beneficiaryData = beneficiary
            }
          }

          // If subscription is active, create a record in our database
          if (paypalData.status === "ACTIVE") {
            const { data: newSubscription, error: createError } = await supabase
              .from("subscriptions")
              .insert({
                stripe_subscription_id: paypalData.id, // Using stripe_subscription_id for PayPal too
                beneficiary_id: paypalData.custom_id,
                user_id: user.id, // Add authenticated user's ID
                customer_id: paypalData.subscriber.payer_id, // Add PayPal payer ID
                sponsorship_method: "PAYPAL", // Set payment method
                amount: Math.round(parseFloat(paypalData.billing_info?.last_payment?.amount?.value || "0") * 100), // Convert to cents
                interval: "month", // PayPal plans are monthly
                status: "complete", // Map PayPal's ACTIVE status to our complete status
                current_period_start: paypalData.billing_info?.last_payment?.time || paypalData.create_time,
                current_period_end: paypalData.billing_info?.next_billing_time,
                created_at: paypalData.create_time
              })
              .select()
              .single()

            if (createError) {
              console.error("Failed to create subscription record:", createError)
            } else {
              console.log("Created subscription record:", newSubscription)
              return NextResponse.json({
                subscription: {
                  ...newSubscription,
                  beneficiaries: beneficiaryData,
                  status: paypalData.status?.toLowerCase()
                },
                paypal_order: null,
              })
            }
          }

          return NextResponse.json({
            subscription: {
              ...paypalData,
              beneficiaries: beneficiaryData,
              status: paypalData.status?.toLowerCase() || "pending"
            },
            paypal_order: null,
          })
        } else {
          console.error("PayPal subscription fetch failed:", paypalData)
          return NextResponse.json(
            { error: "PayPal subscription not found" },
            { status: 404 },
          )
        }
      } catch (paypalError) {
        console.error("PayPal API error:", paypalError)
        return NextResponse.json(
          { error: "Failed to fetch subscription details" },
          { status: 500 },
        )
      }
    } else if (token) {
      // If we only have a token, fetch PayPal order details
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
