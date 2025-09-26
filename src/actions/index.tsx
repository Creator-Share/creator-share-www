import { createClient } from "@/utils/supabase/client"
import { Subscription } from "@/types"

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
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Error fetching activities:", error)
    return []
  }

  return data || []
}
