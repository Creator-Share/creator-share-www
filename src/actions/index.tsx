import { createClient } from "@/utils/supabase/client"
import { Beneficiaries, Subscription } from "@/types"

export type SponsoredWithActivity = Beneficiaries & { last_activity_at: string }

export async function fetchSponsorshipDetailsByBeneficiaryId(
  beneficiaryId: string,
): Promise<Subscription[]> {
  if (!beneficiaryId) return []

  const supabase = createClient()
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      `
      *,
      beneficiary:beneficiaries(
        name
      )
    `,
    )
    .eq("beneficiary_id", beneficiaryId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Error fetching subscriptions:", error)
    return []
  }

  return data || []
}

export async function fetchActivitiesByBeneficiaryId(beneficiaryId: string) {
  if (!beneficiaryId) return []

  const supabase = createClient()
  const { data, error } = await supabase
    .from("activities")
    .select("*")
    .eq("beneficiary_id", beneficiaryId)
    .eq("is_public", true)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Error fetching activities:", error)
    return []
  }

  return data || []
}

/**
 * Fetch sponsored beneficiaries (status = "Budget Fulfilled") who have at least
 * one public activity, ordered by their most recent activity date descending.
 * Used to populate the social-proof story strip on the homepage.
 */
export async function fetchSponsoredWithRecentActivity(): Promise<SponsoredWithActivity[]> {
  const supabase = createClient()

  // Step 1: get public activities ordered by recency to determine display order.
  const { data: activities, error: activitiesError } = await supabase
    .from("activities")
    .select("beneficiary_id, created_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false })

  if (activitiesError) {
    console.error("Error fetching activities for story strip:", activitiesError)
    return []
  }

  if (!activities || activities.length === 0) return []

  // Deduplicate beneficiary IDs, preserving most-recent-first order.
  const seen = new Set<string>()
  const orderedIds: string[] = []
  const latestActivityAt = new Map<string, string>()

  for (const { beneficiary_id, created_at } of activities) {
    if (!beneficiary_id) continue
    if (!seen.has(beneficiary_id)) {
      seen.add(beneficiary_id)
      orderedIds.push(beneficiary_id)
      latestActivityAt.set(beneficiary_id, created_at)
    }
  }

  if (orderedIds.length === 0) return []

  // Step 2: fetch only the beneficiaries that are fully sponsored.
  const { data: beneficiaries, error: beneficiariesError } = await supabase
    .from("beneficiaries")
    .select("*")
    .in("id", orderedIds)
    .eq("status", "Budget Fulfilled")

  if (beneficiariesError) {
    console.error("Error fetching sponsored beneficiaries:", beneficiariesError)
    return []
  }

  if (!beneficiaries || beneficiaries.length === 0) return []

  // Restore the activity-recency ordering and attach last_activity_at.
  const beneficiaryMap = new Map(beneficiaries.map((b) => [b.id, b]))
  return orderedIds
    .filter((id) => beneficiaryMap.has(id))
    .map((id) => ({
      ...(beneficiaryMap.get(id) as Beneficiaries),
      last_activity_at: latestActivityAt.get(id)!,
    }))
}
