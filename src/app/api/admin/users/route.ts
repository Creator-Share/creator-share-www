import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

export async function GET() {
  try {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response

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

    const { data: disabledIds, error: accessError } = await supabase.rpc(
      "get_creator_share_disabled_accounts",
      { target_user_ids: (allUsers ?? []).map(user => user.id) },
    )
    if (accessError || !Array.isArray(disabledIds) || disabledIds.some(id => typeof id !== "string")) {
      return NextResponse.json({ error: "Unable to confirm account access status" }, { status: 503 })
    }
    const disabled = new Set(disabledIds)

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
          user: { ...user, disabled: disabled.has(user.id) },
          role: null
        }
      }
      
      // If user has role assignments, create an entry for each role
      return userRoleAssignments.map(assignment => ({
        user_id: user.id,
        created_at: assignment.created_at,
        user: { ...user, disabled: disabled.has(user.id) },
        role: assignment.role
      }))
    }).flat() || []

    return NextResponse.json(usersWithRoles, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
