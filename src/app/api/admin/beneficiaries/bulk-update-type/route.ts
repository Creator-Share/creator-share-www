import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import {
  ALL_BENEFICIARY_TABS,
  getDefaultBudgetGoal,
  isOpenSponsorshipType,
} from "@/config/beneficiaryTypes"

const VALID_TYPES = ALL_BENEFICIARY_TABS.filter(t => t.type != null && !t.isLegacyAlias).map(t => t.type)

export async function POST(req: Request) {
  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response

  try {
    const { ids, beneficiary_type } = await req.json()

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "No IDs provided" }, { status: 400 })
    }

    if (!beneficiary_type || typeof beneficiary_type !== "string") {
      return NextResponse.json({ error: "beneficiary_type is required" }, { status: 400 })
    }

    if (!(VALID_TYPES as string[]).includes(beneficiary_type)) {
      return NextResponse.json({ error: "Invalid beneficiary_type" }, { status: 400 })
    }

    // Reconcile budget_goal alongside beneficiary_type to keep them in sync
    // (same semantics as the single-edit flow in BeneficiaryModal). Open types
    // get -1 (infinite); fixed types get their config default in cents.
    const budget_goal = isOpenSponsorshipType(beneficiary_type)
      ? -1
      : getDefaultBudgetGoal(beneficiary_type)

    const { error: updateError } = await supabase
      .from("beneficiaries")
      .update({ beneficiary_type, budget_goal })
      .in("id", ids)

    if (updateError) {
      console.error("Supabase bulk type update error:", updateError)
      return NextResponse.json({ error: updateError.message }, { status: 400 })
    }

    return NextResponse.json({
      message: `Successfully updated ${ids.length} beneficiaries to type ${beneficiary_type}`,
    })
  } catch (error) {
    console.error("Bulk type update error:", error)
    return NextResponse.json({ error: "Failed to update beneficiary type" }, { status: 500 })
  }
}
