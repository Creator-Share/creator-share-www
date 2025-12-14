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

  if (!beneficiaryId) {
    return NextResponse.json(
      { error: "beneficiary_id is required" },
      { status: 400 },
    )
  }

  const supabase = await createClient()

  // Fetch all subscriptions for this beneficiary with user information
  const { data: subscriptions, error } = await supabase
    .from("subscriptions")
    .select(
      `
      id,
      user_id,
      amount,
      interval,
      email_notification,
      users(
        email,
        first_name,
        last_name
      )
    `,
    )
    .eq("beneficiary_id", beneficiaryId)
    .eq("status", "complete")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Error fetching sponsors:", error)
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    )
  }

  // Transform the data to a cleaner format
  const sponsors: SponsorInfo[] = (subscriptions || [])
    .map((sub) => {
      // Handle user data - may be an object or array
      const userData = Array.isArray(sub.users) ? sub.users[0] : sub.users

      const email = userData?.email || null
      const firstName = userData?.first_name || null
      const lastName = userData?.last_name || null
      const name =
        firstName && lastName
          ? `${firstName} ${lastName}`
          : firstName || lastName || null

      // If no email, try to fetch it directly from auth.users
      if (!email && sub.user_id) {
        // Note: We can't directly query auth.users from here, but we can return
        // the user_id and let the frontend handle it if needed
        // For now, we'll just skip entries without email
        return null
      }

      if (!email) {
        return null
      }

      return {
        subscriptionId: sub.id,
        userId: sub.user_id,
        email,
        name,
        amount: sub.amount,
        interval: sub.interval,
        emailNotification: sub.email_notification,
      }
    })
    .filter((sponsor): sponsor is SponsorInfo => sponsor !== null)

  return NextResponse.json({ sponsors }, { status: 200 })
}

