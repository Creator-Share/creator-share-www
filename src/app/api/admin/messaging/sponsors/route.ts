import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export interface SponsorInfo {
  subscriptionId: string
  userId: string | null
  email: string
  name: string | null
  amount: number | null
  interval: string | null
  emailNotification: boolean | null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const beneficiaryId = searchParams.get("beneficiary_id")

  console.log("🔍 [SPONSORS API] Fetching sponsors for beneficiary_id:", beneficiaryId)

  if (!beneficiaryId) {
    return NextResponse.json(
      { error: "beneficiary_id is required" },
      { status: 400 },
    )
  }

  const supabase = await createClient()

  // Step 1: Fetch all active subscriptions for this beneficiary
  const { data: subscriptions, error: subsError } = await supabase
    .from("subscriptions")
    .select("id, user_id, amount, interval, email_notification, customer_id")
    .eq("beneficiary_id", beneficiaryId)
    .eq("status", "complete")
    .order("created_at", { ascending: false })

  console.log("📊 [SPONSORS API] Subscriptions query result:", {
    error: subsError?.message || null,
    subscriptionCount: subscriptions?.length || 0,
  })

  if (subsError) {
    console.error("❌ [SPONSORS API] Error fetching subscriptions:", subsError)
    return NextResponse.json(
      { error: subsError.message },
      { status: 500 },
    )
  }

  if (!subscriptions || subscriptions.length === 0) {
    console.log("ℹ️ [SPONSORS API] No active subscriptions found")
    return NextResponse.json({ sponsors: [] }, { status: 200 })
  }

  // Step 2: For each subscription, get customer info from transaction_ledger
  const sponsors: SponsorInfo[] = []

  for (const sub of subscriptions) {
    let email: string | null = null
    let name: string | null = null

    // First, try to get customer info from transaction_ledger
    // Get the most recent transaction for this beneficiary that matches the subscription
    const { data: transactions, error: txError } = await supabase
      .from("transaction_ledger")
      .select("customer_email, customer_name, customer_id")
      .eq("beneficiary_id", beneficiaryId)
      .eq("subscription_type", "subscription")
      .not("customer_email", "is", null)
      .order("created_at", { ascending: false })
      .limit(10) // Get recent transactions to find a match

    if (txError) {
      console.error("⚠️ [SPONSORS API] Error fetching transaction_ledger:", txError)
    }

    // Try to match transaction to subscription by customer_id if available
    let matchedTransaction = null
    if (transactions && transactions.length > 0) {
      if (sub.customer_id) {
        // Try to match by customer_id first
        matchedTransaction = transactions.find(
          (tx) => tx.customer_id === sub.customer_id
        )
      }
      // If no match by customer_id or customer_id not available, use most recent
      if (!matchedTransaction) {
        matchedTransaction = transactions[0]
      }
    }

    if (matchedTransaction) {
      email = matchedTransaction.customer_email
      name = matchedTransaction.customer_name
    }

    // Fallback: Try to get from users table if user_id exists
    if (!email && sub.user_id) {
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("email, first_name, last_name")
        .eq("id", sub.user_id)
        .single()

      if (userError) {
        console.error("⚠️ [SPONSORS API] Error fetching user:", userError)
      }

      if (userData) {
        email = userData.email
        name =
          userData.first_name && userData.last_name
            ? `${userData.first_name} ${userData.last_name}`
            : userData.first_name || userData.last_name || null
      }
    }

    // Only include sponsors with valid email
    if (email) {
      sponsors.push({
        subscriptionId: sub.id,
        userId: sub.user_id,
        email,
        name,
        amount: sub.amount,
        interval: sub.interval,
        emailNotification: sub.email_notification,
      })
    } else {
      console.log(`⚠️ [SPONSORS API] No email found for subscription ${sub.id}`)
    }
  }

  console.log("✅ [SPONSORS API] Successfully fetched sponsors:", {
    totalSponsors: sponsors.length,
    sponsors: sponsors.map(s => ({ email: s.email, name: s.name }))
  })

  return NextResponse.json({ sponsors }, { status: 200 })
}

