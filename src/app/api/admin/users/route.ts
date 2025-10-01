import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import {  RoleAssignmentResponse } from "@/types"

export async function GET() {
  try {
    const supabase = await createClient()
    
    // Check if user is authenticated and has SUPER_ADMIN role
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Check user role - handle multiple roles
    const { data: roleData, error: roleError } = await supabase
      .from("role_assignments")
      .select(`
        roles:roles!role_assignments_role_id_fkey(name)
      `)
      .eq("user_id", user.id)

    // Check if user has SUPER_ADMIN role among any of their assigned roles
    const typedRoleData = (roleData as unknown) as RoleAssignmentResponse
    const hasSuperAdminRole = typedRoleData?.some((assignment) => 
      assignment.roles.name === "SUPER_ADMIN"
    )

    if (roleError || !roleData || !hasSuperAdminRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Fetch users with their roles
    const { data: users, error } = await supabase
      .from("role_assignments")
      .select(`
        user_id,
        created_at,
        user:users!role_assignments_user_id_fkey(
          id,
          email,
          first_name,
          last_name,
          created_at
        ),
        role:roles!role_assignments_role_id_fkey(
          id,
          name,
          display_name,
          description
        )
      `)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Error fetching users:", error)
      return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 })
    }

    return NextResponse.json(users || [])
  } catch (error) {
    console.error("Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
