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
