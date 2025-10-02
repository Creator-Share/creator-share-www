import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { RoleAssignmentResponse } from "@/types"

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

    const typedRoleData = (roleData as unknown) as RoleAssignmentResponse
    const hasSuperAdminRole = typedRoleData?.some((assignment) => 
      assignment.roles.name === "SUPER_ADMIN"
    )

    if (roleError || !roleData || !hasSuperAdminRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Fetch all users first
    const { data: allUsers, error: usersError } = await supabase
      .from("users")
      .select(`
        id,
        email,
        first_name,
        last_name,
        created_at
      `)
      .order("created_at", { ascending: false })

    if (usersError) {
      console.error("Error fetching users:", usersError)
      return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 })
    }

    // Fetch all role assignments
    const { data: roleAssignments, error: rolesError } = await supabase
      .from("role_assignments")
      .select(`
        user_id,
        created_at,
        role:roles!role_assignments_role_id_fkey(
          id,
          name,
          display_name,
          description
        )
      `)

    if (rolesError) {
      console.error("Error fetching role assignments:", rolesError)
      return NextResponse.json({ error: "Failed to fetch role assignments" }, { status: 500 })
    }

    // Combine users with their role assignments
    const usersWithRoles = allUsers?.map(user => {
      const userRoleAssignments = roleAssignments?.filter(assignment => assignment.user_id === user.id) || []
      
      // If user has no role assignments, create a single entry with no role
      if (userRoleAssignments.length === 0) {
        return {
          user_id: user.id,
          created_at: user.created_at,
          user: user,
          role: null
        }
      }
      
      // If user has role assignments, create an entry for each role
      return userRoleAssignments.map(assignment => ({
        user_id: user.id,
        created_at: assignment.created_at,
        user: user,
        role: assignment.role
      }))
    }).flat() || []

    return NextResponse.json(usersWithRoles)
  } catch (error) {
    console.error("Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
