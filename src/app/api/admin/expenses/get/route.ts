import { createClient } from "@/utils/supabase/server"
import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response

    const { data: expenses, error } = await supabase
      .from("expenses")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Error fetching expenses:", error)
      return NextResponse.json(
        { error: "Failed to fetch expenses" },
        { status: 500 },
      )
    }

    return NextResponse.json(expenses)
  } catch (error) {
    console.error("Error in expenses GET:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
