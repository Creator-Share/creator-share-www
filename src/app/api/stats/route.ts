import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export async function GET() {
  const supabase = await createClient()

  try {
    // Get total number of children under care (all statuses except Draft and Archived)
    const { count: totalChildren, error: childrenError } = await supabase
      .from("beneficiaries")
      .select("*", { count: "exact", head: true })
      .eq("beneficiary_type", "CHILD")
      .not("status", "in", '("Draft","Archived")')

    if (childrenError) {
      console.error("Error fetching children count:", childrenError)
      return NextResponse.json(
        { error: "Failed to fetch children count" },
        { status: 500 }
      )
    }

    // Get total number of active sponsorships across the platform
    const { data: sponsorshipData, error: sponsorshipError } = await supabase
      .from("beneficiaries")
      .select("active_subscriptions")
      .eq("beneficiary_type", "CHILD")

    if (sponsorshipError) {
      console.error("Error fetching sponsorships:", sponsorshipError)
      return NextResponse.json(
        { error: "Failed to fetch sponsorships count" },
        { status: 500 }
      )
    }

    // Sum up all active subscriptions
    const totalActiveSubscriptions = sponsorshipData?.reduce(
      (sum, beneficiary) => sum + (beneficiary.active_subscriptions || 0),
      0
    ) || 0

    return NextResponse.json({
      totalChildren: totalChildren || 0,
      totalActiveSubscriptions,
    })
  } catch (err) {
    console.error("Unexpected error fetching stats:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
