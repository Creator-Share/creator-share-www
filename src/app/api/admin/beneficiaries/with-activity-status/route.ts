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

    // Public activities with image/video (sponsor-visible media on updates)
    const { data: publicActivities, error: publicActivitiesError } =
      await supabase
        .from("activities")
        .select("id, beneficiary_id")
        .in("beneficiary_id", beneficiaryIds)
        .eq("is_public", true)

    if (publicActivitiesError) {
      return NextResponse.json(
        { error: publicActivitiesError.message },
        { status: 500 }
      )
    }

    const publicActivityList = publicActivities || []
    const publicActivityIds = publicActivityList
      .map((a) => a.id)
      .filter((id): id is string => Boolean(id))

    const activityIdsWithMedia = new Set<string>()
    const MEDIA_BATCH = 200

    for (let i = 0; i < publicActivityIds.length; i += MEDIA_BATCH) {
      const batch = publicActivityIds.slice(i, i + MEDIA_BATCH)
      const { data: mediaRows, error: mediaError } = await supabase
        .from("media")
        .select("parent_id")
        .in("parent_id", batch)
        .in("type", ["IMAGE", "VIDEO"])

      if (mediaError) {
        return NextResponse.json(
          { error: mediaError.message },
          { status: 500 }
        )
      }

      for (const row of mediaRows || []) {
        if (row.parent_id) {
          activityIdsWithMedia.add(String(row.parent_id))
        }
      }
    }

    const beneficiariesWithPublicMedia = new Set<string>()
    for (const row of publicActivityList) {
      if (
        row.beneficiary_id &&
        row.id &&
        activityIdsWithMedia.has(String(row.id))
      ) {
        beneficiariesWithPublicMedia.add(String(row.beneficiary_id))
      }
    }

    // Calculate days since last activity and enrich beneficiaries
    const now = new Date()
    const enrichedBeneficiaries: BeneficiaryWithActivity[] = beneficiaries.map(
      (beneficiary) => {
        const id = beneficiary.id!
        const lastActivityDate = activityMap.get(id) || null
        let daysSinceLastActivity = 999999

        if (lastActivityDate) {
          const lastDate = new Date(lastActivityDate)
          const diffTime = now.getTime() - lastDate.getTime()
          daysSinceLastActivity = Math.floor(diffTime / (1000 * 60 * 60 * 24))
        }

        return {
          ...beneficiary,
          last_activity_date: lastActivityDate,
          days_since_last_activity: daysSinceLastActivity,
          has_activity: lastActivityDate !== null,
          has_public_activity_media: beneficiariesWithPublicMedia.has(id),
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
