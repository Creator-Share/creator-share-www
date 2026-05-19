import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { BeneficiaryType, isBeneficiaryType } from "@/types/admin.types"

export async function GET(req: Request) {
  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const beneficiaryTypeParam = searchParams.get("beneficiary_type")

  // Support comma-separated list of types (e.g. "CHILD,CHILD_LABORER")
  // If no type is provided, return stats for ALL beneficiary types
  const beneficiaryTypes: BeneficiaryType[] = beneficiaryTypeParam
    ? beneficiaryTypeParam.split(",").map((t) => t.trim()).filter(isBeneficiaryType)
    : []

  try {
    // Get all beneficiaries of this type (or types); no filter = all types
    let query = supabase.from("beneficiaries").select("status")
    if (beneficiaryTypes.length === 1) {
      query = query.eq("beneficiary_type", beneficiaryTypes[0])
    } else if (beneficiaryTypes.length > 1) {
      query = query.in("beneficiary_type", beneficiaryTypes)
    }
    // beneficiaryTypes.length === 0 → no filter → all types
    const { data, error } = await query

    if (error) {
      console.error("Supabase error:", error)
      return NextResponse.json({ error: "Database error" }, { status: 500 })
    }

    // Count by status
    const statusCounts: Record<string, number> = {
      "New": 0,
      "Partially Funded": 0,
      "Budget Fulfilled": 0,
      "Draft": 0,
      "Archived": 0,
      "Sponsorship Cancelled": 0,
    }

    let total = 0
    data?.forEach((item) => {
      total++
      if (item.status && statusCounts.hasOwnProperty(item.status)) {
        statusCounts[item.status]++
      }
    })

    return NextResponse.json({
      total,
      statusCounts,
    })
  } catch (err) {
    console.error("Unexpected error:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

