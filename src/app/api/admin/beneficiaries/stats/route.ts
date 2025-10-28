import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { BeneficiaryType } from "@/types/admin.types"

export async function GET(req: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)
  const beneficiaryType = searchParams.get("beneficiary_type") as BeneficiaryType | null

  if (!beneficiaryType) {
    return NextResponse.json(
      { error: "beneficiary_type is required" },
      { status: 400 }
    )
  }

  try {
    // Get all beneficiaries of this type
    const { data, error } = await supabase
      .from("beneficiaries")
      .select("status")
      .eq("beneficiary_type", beneficiaryType)

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

