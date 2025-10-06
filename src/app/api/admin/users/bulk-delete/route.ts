import { NextResponse } from "next/server"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"
import { SingleRoleData } from "@/types"

export async function POST(req: Request) {
  try {
    const { ids } = await req.json()
    
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "No user IDs provided" }, { status: 400 })
    }

    // Check if current user is SUPER_ADMIN
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Check if user has SUPER_ADMIN role
    const { data: roleData, error: roleError } = await supabase
      .from("role_assignments")
      .select("roles(name)")
      .eq("user_id", user.id)
      .single()

    const typedRoleData = (roleData as unknown) as SingleRoleData
    if (roleError || !typedRoleData?.roles?.length || !typedRoleData.roles.some(role => role.name === "SUPER_ADMIN")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // Use service role client for bulk operations
    const serviceSupabase = createServiceRoleClient()

    // Delete in order: role_assignments first, then users
    const { error: roleAssignmentsError } = await serviceSupabase
      .from("role_assignments")
      .delete()
      .in("user_id", ids)

    if (roleAssignmentsError) {
      return NextResponse.json(
        { error: `Failed to delete role assignments: ${roleAssignmentsError.message}` },
        { status: 400 }
      )
    }

    // Delete users
    const { error: usersError } = await serviceSupabase
      .from("users")
      .delete()
      .in("id", ids)

    if (usersError) {
      return NextResponse.json(
        { error: `Failed to delete users: ${usersError.message}` },
        { status: 400 }
      )
    }

    return NextResponse.json({ 
      success: true, 
      message: `Successfully deleted ${ids.length} users` 
    }, { status: 200 })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
