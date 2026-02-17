import { createClient } from "@/utils/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response
    const { id } = await params

    const { error } = await supabase
      .from("expense_assignments")
      .delete()
      .eq("id", id)

    if (error) {
      console.error("Error deleting expense assignment:", error)
      return NextResponse.json(
        { error: "Failed to delete expense assignment" },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error in expense assignment DELETE:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
