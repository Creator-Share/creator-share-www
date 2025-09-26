import { createClient } from "@/utils/supabase/server"
import { NextRequest, NextResponse } from "next/server"

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient()
    const { id } = await params

    console.log("Deleting expense with ID:", id)

    // First, check if the expense exists
    const { data: existingExpense, error: checkError } = await supabase
      .from("expenses")
      .select("id")
      .eq("id", id)
      .single()

    if (checkError || !existingExpense) {
      console.error("Expense not found:", id)
      return NextResponse.json({ error: "Expense not found" }, { status: 404 })
    }

    // Delete the expense (this should cascade to expense_assignments)
    const { error } = await supabase.from("expenses").delete().eq("id", id)

    if (error) {
      console.error("Error deleting expense:", error)
      return NextResponse.json(
        { error: `Failed to delete expense: ${error.message}` },
        { status: 500 },
      )
    }

    console.log("Expense deleted successfully")
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error in expense DELETE:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
