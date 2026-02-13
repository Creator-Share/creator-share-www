import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response

    const { userId, roleIds } = await request.json()

    if (!userId || !roleIds || !Array.isArray(roleIds)) {
      return NextResponse.json({ error: "User ID and Role IDs array are required" }, { status: 400 })
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

    // Check if all roles exist
    const { data: roles, error: rolesError } = await supabase
      .from("roles")
      .select("id, name")
      .in("id", roleIds)

    if (rolesError || !roles || roles.length !== roleIds.length) {
      return NextResponse.json({ error: "One or more roles not found" }, { status: 404 })
    }

    // Start a transaction-like operation
    // First, remove all existing role assignments for this user
    const { error: deleteError } = await supabase
      .from("role_assignments")
      .delete()
      .eq("user_id", userId)

    if (deleteError) {
      console.error("Error removing existing role assignments:", deleteError)
      return NextResponse.json({ error: "Failed to remove existing roles" }, { status: 500 })
    }

    // Then, add the new role assignments
    if (roleIds.length > 0) {
      const newAssignments = roleIds.map(roleId => ({
        user_id: userId,
        role_id: roleId,
        created_at: new Date().toISOString()
      }))

      const { error: insertError } = await supabase
        .from("role_assignments")
        .insert(newAssignments)

      if (insertError) {
        console.error("Error adding new role assignments:", insertError)
        return NextResponse.json({ error: "Failed to assign roles" }, { status: 500 })
      }
    }

    return NextResponse.json({ 
      message: "User roles updated successfully",
      user: targetUser,
      roles: roles
    })
  } catch (error) {
    console.error("Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
