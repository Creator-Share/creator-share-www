import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

export async function PUT(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response

    const { userId, roleId } = await request.json()

    if (!userId || !roleId) {
      return NextResponse.json({ error: "User ID and Role ID are required" }, { status: 400 })
    }

    // Check if the target user exists
    const { data: targetUser, error: userError } = await supabase
      .from("users")
      .select("id, email")
      .eq("id", userId)
      .single()

    if (userError || !targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Check if the role exists
    const { data: role, error: roleExistsError } = await supabase
      .from("roles")
      .select("id, name")
      .eq("id", roleId)
      .single()

    if (roleExistsError || !role) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 })
    }

    // Update the user's role assignment
    const { error: updateError } = await supabase
      .from("role_assignments")
      .update({ role_id: roleId })
      .eq("user_id", userId)

    if (updateError) {
      console.error("Error updating user role:", updateError)
      return NextResponse.json({ error: "Failed to update user role" }, { status: 500 })
    }

    return NextResponse.json({ 
      message: "User role updated successfully",
      user: targetUser,
      role: role
    })
  } catch (error) {
    console.error("Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}