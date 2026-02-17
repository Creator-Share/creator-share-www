import { createClient } from "@/utils/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response

    const { searchParams } = new URL(request.url)
    const beneficiaryId = searchParams.get("beneficiary_id")

    let query = supabase
      .from("expense_assignments")
      .select(
        `
        *,
        expenses (*)
      `,
      )
      .order("created_at", { ascending: false })

    if (beneficiaryId) {
      query = query.eq("beneficiary_id", beneficiaryId)
    }

    const { data: assignments, error } = await query

    if (error) {
      console.error("Error fetching expense assignments:", error)
      return NextResponse.json(
        { error: "Failed to fetch expense assignments" },
        { status: 500 },
      )
    }

    return NextResponse.json(assignments)
  } catch (error) {
    console.error("Error in expense assignments GET:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
