import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import type { BeneficiaryWithActivity } from "@/types/admin.types"

export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response

    // Fetch all sponsored beneficiaries (CHILD type with active subscriptions)
    const { data: beneficiaries, error: beneficiariesError } = await supabase
      .from("beneficiaries")
      .select("*")
      .eq("beneficiary_type", "CHILD")
      .gt("active_subscriptions", 0)

    if (beneficiariesError) {
      return NextResponse.json(
        { error: beneficiariesError.message },
        { status: 500 }
      )
    }

    if (!beneficiaries || beneficiaries.length === 0) {
      return NextResponse.json({ beneficiaries: [] })
    }

    // Extract beneficiary IDs
    const beneficiaryIds = beneficiaries.map((b) => b.id)

    // Fetch all activities for these beneficiaries
    const { data: activities, error: activitiesError } = await supabase
      .from("activities")
      .select("beneficiary_id, created_at")
      .in("beneficiary_id", beneficiaryIds)
      .order("created_at", { ascending: false })

    if (activitiesError) {
      return NextResponse.json(
        { error: activitiesError.message },
        { status: 500 }
      )
    }

    // Aggregate last activity date per beneficiary (client-side)
    const activityMap = new Map<string, string>()
    
    if (activities) {
      for (const activity of activities) {
        if (activity.beneficiary_id && activity.created_at) {
          // Only set if not already set (since we're sorted by created_at desc)
          if (!activityMap.has(activity.beneficiary_id)) {
            activityMap.set(activity.beneficiary_id, activity.created_at)
          }
        }
      }
    }

    // Calculate days since last activity and enrich beneficiaries
    const now = new Date()
    const enrichedBeneficiaries: BeneficiaryWithActivity[] = beneficiaries.map(
      (beneficiary) => {
        const lastActivityDate = activityMap.get(beneficiary.id!) || null
        let daysSinceLastActivity = 999999

        if (lastActivityDate) {
          const lastDate = new Date(lastActivityDate)
          const diffTime = now.getTime() - lastDate.getTime()
          daysSinceLastActivity = Math.floor(diffTime / (1000 * 60 * 60 * 24))
        }

        return {
          ...beneficiary,
          last_activity_date: lastActivityDate,
          days_since_last_activity: daysSinceLastActivity
        }
      }
    )

    return NextResponse.json({ beneficiaries: enrichedBeneficiaries })
  } catch (error) {
    console.error("Error fetching beneficiaries with activity status:", error)
    return NextResponse.json(
      { error: "Failed to fetch beneficiaries with activity status" },
      { status: 500 }
    )
  }
}
