import { createClient } from "@/utils/supabase/client"
import { Beneficiaries } from "@/types"

/** @deprecated Use SponsoredBeneficiary instead */
export type SponsoredWithActivity = Beneficiaries & { last_activity_at: string }

/**
 * A Budget Fulfilled beneficiary with an optional last public-activity timestamp.
 * `last_activity_at` is null when no public activity has been recorded.
 */
export type SponsoredBeneficiary = Beneficiaries & { last_activity_at: string | null }

export interface PublicBeneficiarySponsorshipMilestone {
  beneficiary_id: string
  sponsorship_count_floor: number
}

export async function fetchSponsorshipDetailsByBeneficiaryId(
  beneficiaryId: string,
): Promise<PublicBeneficiarySponsorshipMilestone | null> {
  if (!beneficiaryId) return null

  const supabase = createClient()
  const { data, error } = await supabase
    .from("public_beneficiary_sponsorship_milestones")
    .select("beneficiary_id, sponsorship_count_floor")
    .eq("beneficiary_id", beneficiaryId)
    .maybeSingle()

  if (error) {
    console.error("Error fetching public sponsorship totals:", error)
    return null
  }

  return (data as PublicBeneficiarySponsorshipMilestone | null) ?? null
}

/**
 * Fetch public activities for a beneficiary with media URLs pre-resolved.
 * Uses the server-side API route to avoid client-side RLS limitations on
 * the media table.
 */
export async function fetchActivitiesByBeneficiaryId(
  beneficiaryId: string,
  signal?: AbortSignal,
) {
  if (!beneficiaryId) return []

  try {
    const res = await fetch(`/api/beneficiaries/${beneficiaryId}/activities`, {
      signal,
    })
    if (!res.ok) {
      console.error("Error fetching activities:", res.statusText)
      return []
    }
    const data = await res.json()
    return data.activities ?? []
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return []
    }
    console.error("Error fetching activities:", err)
    return []
  }
}

/**
 * Fetch Budget Fulfilled beneficiaries, annotated with the timestamp of
 * their most recent public activity (null if none exists).
 *
 * Pass `beneficiaryTypes` to restrict to specific DB beneficiary_type values.
 * When omitted, all types are included.
 *
 * Ordering: beneficiaries with activity appear first (most recent first),
 * then those without activity sorted alphabetically by name.
 */
export async function fetchAllSponsored(
  beneficiaryTypes?: string[],
): Promise<SponsoredBeneficiary[]> {
  const supabase = createClient()

  let query = supabase
    .from("public_beneficiaries")
    .select("*")
    .eq("status", "Budget Fulfilled")
    .order("name", { ascending: true })

  if (beneficiaryTypes && beneficiaryTypes.length > 0) {
    query = query.in("beneficiary_type", beneficiaryTypes)
  }

  const { data: beneficiaries, error } = await query

  if (error || !beneficiaries || beneficiaries.length === 0) {
    if (error) console.error("Error fetching sponsored beneficiaries:", error)
    return []
  }

  const ids = beneficiaries.map((b) => b.id).filter(Boolean)

  const { data: activities } = await supabase
    .from("public_activities")
    .select("beneficiary_id, created_at")
    .in("beneficiary_id", ids)
    .order("created_at", { ascending: false })

  const latestActivityAt = new Map<string, string>()
  for (const { beneficiary_id, created_at } of activities ?? []) {
    if (beneficiary_id && !latestActivityAt.has(beneficiary_id)) {
      latestActivityAt.set(beneficiary_id, created_at)
    }
  }

  return beneficiaries
    .map((b) => ({ ...b, last_activity_at: latestActivityAt.get(b.id) ?? null }))
    .sort((a, b) => {
      if (a.last_activity_at && b.last_activity_at) {
        return new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime()
      }
      if (a.last_activity_at) return -1
      if (b.last_activity_at) return 1
      return (a.name ?? "").localeCompare(b.name ?? "")
    })
}

/**
 * @deprecated Use fetchAllSponsored instead; this only returns children WITH activity.
 */
export async function fetchSponsoredWithRecentActivity(): Promise<SponsoredWithActivity[]> {
  const supabase = createClient()

  // Step 1: get public activities ordered by recency to determine display order.
  const { data: activities, error: activitiesError } = await supabase
    .from("public_activities")
    .select("beneficiary_id, created_at")
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
    .from("public_beneficiaries")
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
