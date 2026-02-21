import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response

    const { userId, roleId } = await request.json()

    if (!userId || !roleId) {
      return NextResponse.json(
        { error: "userId and roleId are required" },
        { status: 400 }
      )
    }

    // Remove role assignment
    const { error } = await supabase
      .from("role_assignments")
      .delete()
      .eq("user_id", userId)
      .eq("role_id", roleId)

    if (error) {
      console.error("Error removing role:", error)
      return NextResponse.json({ error: "Failed to remove role" }, { status: 500 })
    }

    return NextResponse.json({ message: "Role removed successfully" })
  } catch (error) {
    console.error("Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

