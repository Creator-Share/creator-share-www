import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { BULK_ASSIGNABLE_TYPES } from "@/config/beneficiaryTypes"

const VALID_TYPES = BULK_ASSIGNABLE_TYPES.map((t) => t.type)

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

    const { error: updateError } = await supabase
      .from("beneficiaries")
      .update({ beneficiary_type })
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
