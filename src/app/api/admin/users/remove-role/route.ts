import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    
    // Check if user is authenticated and has SUPER_ADMIN role
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Check user role
    const { data: roleData } = await supabase
      .from("role_assignments")
      .select("roles:roles!role_assignments_role_id_fkey(name)")
      .eq("user_id", user.id)
      .single()

    if (!roleData || roleData.roles[0]?.name !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

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

