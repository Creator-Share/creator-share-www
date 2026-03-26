import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { BeneficiaryType } from "@/types/admin.types"

export async function GET(req: Request) {
  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const beneficiaryTypeParam = searchParams.get("beneficiary_type")

  if (!beneficiaryTypeParam) {
    return NextResponse.json(
      { error: "beneficiary_type is required" },
      { status: 400 }
    )
  }

  // Support comma-separated list of types (e.g. "CHILD,CHILD_LABORER")
  const beneficiaryTypes = beneficiaryTypeParam.split(",").map((t) => t.trim()) as BeneficiaryType[]

  try {
    // Get all beneficiaries of this type (or types)
    const query = supabase.from("beneficiaries").select("status")
    const { data, error } = beneficiaryTypes.length === 1
      ? await query.eq("beneficiary_type", beneficiaryTypes[0])
      : await query.in("beneficiary_type", beneficiaryTypes)

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

