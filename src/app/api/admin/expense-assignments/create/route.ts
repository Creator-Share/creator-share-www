import { createClient } from "@/utils/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { ExpenseAssignment } from "@/types/admin.types"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response

    const body: ExpenseAssignment = await request.json()

    // Validate required fields
    if (!body.beneficiary_id || !body.expense_id) {
      return NextResponse.json(
        { error: "Beneficiary ID and expense ID are required" },
        { status: 400 },
      )
    }

    const { data: assignment, error } = await supabase
      .from("expense_assignments")
      .insert([
        {
          beneficiary_id: body.beneficiary_id,
          expense_id: body.expense_id,
          weight: body.weight || 1,
          fulfilled: body.fulfilled || false,
          onetime_expense: body.onetime_expense || false,
        },
      ])
      .select()
      .single()

    if (error) {
      console.error("Error creating expense assignment:", error)
      return NextResponse.json(
        { error: "Failed to create expense assignment" },
        { status: 500 },
      )
    }

    return NextResponse.json(assignment)
  } catch (error) {
    console.error("Error in expense assignments POST:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
