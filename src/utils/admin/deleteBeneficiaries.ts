import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { deleteFile, type MediaRow } from "@/utils/supabase/media"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Commit all database deletions before attempting any irreversible storage work. */
export async function deleteBeneficiaries(
  supabase: SupabaseClient,
  suppliedIds: unknown,
): Promise<NextResponse> {
  if (
    !Array.isArray(suppliedIds) || suppliedIds.length === 0 || suppliedIds.length > 500 ||
    suppliedIds.some(id => typeof id !== "string" || !UUID_PATTERN.test(id))
  ) {
    return NextResponse.json({ error: "Provide between 1 and 500 valid beneficiary IDs" }, { status: 400 })
  }
  const ids = [...new Set((suppliedIds as string[]).map(id => id.toLowerCase()))]
  const requestId = crypto.randomUUID()
  const { data, error } = await supabase.rpc("delete_creator_share_beneficiaries", {
    target_beneficiary_ids: ids,
    request_id: requestId,
  })
  if (error) {
    if (error.code === "23503" || error.code === "23001") {
      return NextResponse.json({ error: "A selected child has sponsorship or payment records. Archive the child instead." }, { status: 409 })
    }
    const status = error.code === "42501" || error.code === "28000" ? 403 : 500
    return NextResponse.json({ error: "Unable to delete the selected children" }, { status })
  }
  if (!data || !Array.isArray(data.media) || !Number.isSafeInteger(data.deleted_count)) {
    return NextResponse.json({ error: "Unable to confirm beneficiary deletion" }, { status: 500 })
  }

  // Storage remains best effort, as in the existing deletion flow. Failures and
  // lost responses need reconciliation; they must never trigger another DB delete.
  for (const media of data.media as MediaRow[]) {
    try {
      const result = await deleteFile(supabase, media)
      if (result.error) console.error("Beneficiary storage cleanup failed", { requestId })
    } catch {
      console.error("Beneficiary storage cleanup failed", { requestId })
    }
  }
  return NextResponse.json({ success: true })
}
