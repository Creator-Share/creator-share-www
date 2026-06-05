import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { redactEmail } from "@/utils/privacy"

export interface SponsorInfo {
  subscriptionId: string
  emailRedacted: string
  name: string | null
  amount: number | null
  interval: string | null
  emailNotification: boolean | null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const beneficiaryId = searchParams.get("beneficiary_id")
  if (!beneficiaryId) {
    return NextResponse.json(
      { error: "beneficiary_id is required" },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response

  // Step 1: Fetch all active subscriptions with direct email read
  const { data: subscriptions, error: subsError } = await supabase
    .from("subscriptions")
    .select("id, email, email_notification, amount, interval, customer_id")
    .eq("beneficiary_id", beneficiaryId)
    .eq("status", "complete")
    .order("created_at", { ascending: false })

  if (subsError) {
    console.error("❌ [SPONSORS API] Error fetching subscriptions:", subsError)
    return NextResponse.json(
      { error: subsError.message },
      { status: 500 },
    )
  }

  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ sponsors: [] }, { status: 200 })
  }

  // Step 2: Batch resolve missing emails from transaction_ledger via FK join
  // Build a map keyed by subscription id for fast lookup
  const emailFromTledger = new Map<string, { customer_email: string; customer_name: string | null }>()

  const missingEmailIds = subscriptions
    .filter((s) => !s.email)
    .map((s) => s.id)

  if (missingEmailIds.length > 0) {
    const { data: txRows } = await supabase
      .from("transaction_ledger")
      .select("subscription_id, customer_email, customer_name")
      .in("subscription_id", missingEmailIds)
      .not("customer_email", "is", null)

    if (txRows) {
      for (const tx of txRows) {
        if (tx.subscription_id && tx.customer_email) {
          // Only set if not already set (first match wins — most recent ordering
          // would require ordering but any email is better than none for now)
          if (!emailFromTledger.has(tx.subscription_id)) {
            emailFromTledger.set(tx.subscription_id, {
              customer_email: tx.customer_email,
              customer_name: tx.customer_name,
            })
          }
        }
      }
    }
  }

  // Step 3: Build the result list — single pass, no N+1
  const sponsors: SponsorInfo[] = []

  for (const sub of subscriptions) {
    let email: string | null = sub.email
    let name: string | null = null

    // Fallback to tledger FK join result if email not on subscriptions row
    if (!email) {
      const tledger = emailFromTledger.get(sub.id)
      if (tledger) {
        email = tledger.customer_email
        name = tledger.customer_name ? tledger.customer_name.split(" ")[0] : null
      }
    }

    // Skip unresolvable — log warning for backfill gap
    if (!email) {
      console.warn("⚠️ [SPONSORS API] No email resolvable for subscription:", {
        subscriptionId: sub.id,
        beneficiaryId,
      })
      continue
    }

    sponsors.push({
      subscriptionId: sub.id,
      emailRedacted: redactEmail(email),
      name,
      amount: sub.amount,
      interval: sub.interval,
      emailNotification: sub.email_notification,
    })
  }

  return NextResponse.json({ sponsors }, { status: 200 })
}
