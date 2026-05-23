import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { createServiceRoleClient } from "@/utils/supabase/server"
import { RoleAssignmentResponse } from "@/types"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/notifications
 * Returns unread notifications for the admin console, newest first.
 */
export async function GET(req: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Verify SUPER_ADMIN role
  const { data: roleData } = await supabase
    .from("role_assignments")
    .select("roles:roles!role_assignments_role_id_fkey(name)")
    .eq("user_id", user.id)

  const typedRoleData = roleData as unknown as RoleAssignmentResponse
  const isSuperAdmin = typedRoleData?.some(
    (assignment) => assignment.roles.name === "SUPER_ADMIN",
  )

  if (!isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const limit = parseInt(searchParams.get("limit") || "50")
  const includeRead = searchParams.get("includeRead") === "true"

  const svc = createServiceRoleClient()
  let query = svc
    .from("admin_notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (!includeRead) {
    query = query.eq("read", false)
  }

  const { data, error } = await query

  if (error) {
    console.error("[Notifications] Error fetching:", error)
    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 },
    )
  }

  // Also return unread count for badge
  const { count: unreadCount } = await svc
    .from("admin_notifications")
    .select("*", { count: "exact", head: true })
    .eq("read", false)

  return NextResponse.json({
    notifications: data || [],
    unreadCount: unreadCount || 0,
  })
}

/**
 * PATCH /api/admin/notifications
 * Mark one or all notifications as read.
 * Body: { id?: string } — if id provided, marks that one; otherwise marks all.
 */
export async function PATCH(req: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Verify SUPER_ADMIN role
  const { data: roleData } = await supabase
    .from("role_assignments")
    .select("roles:roles!role_assignments_role_id_fkey(name)")
    .eq("user_id", user.id)

  const typedRoleData = roleData as unknown as RoleAssignmentResponse
  const isSuperAdmin = typedRoleData?.some(
    (assignment) => assignment.roles.name === "SUPER_ADMIN",
  )

  if (!isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await req.json()
  const svc = createServiceRoleClient()

  if (id) {
    const { error } = await svc
      .from("admin_notifications")
      .update({ read: true })
      .eq("id", id)

    if (error) {
      console.error("[Notifications] Error marking as read:", error)
      return NextResponse.json(
        { error: "Failed to mark notification as read" },
        { status: 500 },
      )
    }
  } else {
    const { error } = await svc
      .from("admin_notifications")
      .update({ read: true })
      .eq("read", false)

    if (error) {
      console.error("[Notifications] Error marking all as read:", error)
      return NextResponse.json(
        { error: "Failed to mark notifications as read" },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({ success: true })
}
