/**
 * Server-side utility for fetching a beneficiary's primary image URL.
 *
 * Uses the Supabase service-role client so it can be called safely from any
 * server context (webhooks, notification services, etc.) without requiring an
 * authenticated user session.
 */

import { createServiceRoleClient } from "@/utils/supabase/server"
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media"

/**
 * Fetch the public URL for the first IMAGE media row belonging to a beneficiary.
 *
 * @param beneficiaryId - The beneficiary's UUID / ID
 * @returns The public image URL, or `null` if no image is found or an error occurs
 */
export async function getBeneficiaryImageUrl(
  beneficiaryId: string,
): Promise<string | null> {
  if (!beneficiaryId) return null

  try {
    const supabase = createServiceRoleClient()

    const { data, error } = await supabase
      .from("media")
      .select("*")
      .eq("parent_id", beneficiaryId)
      .eq("type", "IMAGE")
      .order("weight")
      .limit(1)
      .single()

    if (error || !data) {
      // PGRST116 = no rows found — not a real error, just no image
      if (error?.code !== "PGRST116") {
        console.warn(
          `getBeneficiaryImageUrl: query error for ${beneficiaryId}:`,
          error?.message,
        )
      }
      return null
    }

    return generatePublicUrl(data as MediaRow)
  } catch (err) {
    console.warn(
      `getBeneficiaryImageUrl: unexpected error for ${beneficiaryId}:`,
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
