import { NextResponse } from "next/server"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"

export async function POST() {
  try {
    const supabase = await createClient()
    const serviceSupabase = createServiceRoleClient()
    
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const roleIds = user.user_metadata?.role_ids

    if (!roleIds || roleIds.length === 0) {
      console.error("No role_ids found in user metadata")
      return NextResponse.json({ error: "No roles assigned" }, { status: 400 })
    }

    const { data: roles, error: rolesError } = await serviceSupabase
      .from("roles")
      .select("id, name")
      .in("id", roleIds)

    if (rolesError || !roles || roles.length !== roleIds.length) {
      return NextResponse.json({ error: "One or more roles not found" }, { status: 404 })
    }

    // Remove all existing role assignments for this user
    const { error: deleteError } = await serviceSupabase
      .from("role_assignments")
      .delete()
      .eq("user_id", user.id)

    if (deleteError) {
      console.error("Error removing existing role assignments:", deleteError)
      return NextResponse.json({ error: "Failed to remove existing roles" }, { status: 500 })
    }

    // Add all new role assignments
    const newAssignments = roleIds.map((roleId: string) => ({
      user_id: user.id,
      role_id: roleId,
      created_at: new Date().toISOString()
    }))

    const { error: insertError } = await serviceSupabase
      .from("role_assignments")
      .insert(newAssignments)

    if (insertError) {
      console.error("Error adding new role assignments:", insertError)
      return NextResponse.json({ error: "Failed to assign roles" }, { status: 500 })
    }
    return NextResponse.json({ 
      message: "Roles assigned successfully",
      roles: roles
    })
  } catch (error) {
    console.error("Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}