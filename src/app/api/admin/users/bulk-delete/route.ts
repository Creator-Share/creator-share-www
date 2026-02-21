import { NextResponse } from "next/server"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

export async function POST(req: Request) {
  try {
    const { ids } = await req.json()
    
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "No user IDs provided" }, { status: 400 })
    }

    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response

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
