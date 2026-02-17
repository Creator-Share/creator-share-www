import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response

    // Fetch roles
    const { data: roles, error } = await supabase
      .from("roles")
      .select("*")
      .order("name")

    if (error) {
      console.error("Error fetching roles:", error)
      return NextResponse.json({ error: "Failed to fetch roles" }, { status: 500 })
    }

    return NextResponse.json(roles || [])
  } catch (error) {
    console.error("Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
