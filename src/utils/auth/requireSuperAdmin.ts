import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { User } from "@supabase/supabase-js"
import { RoleAssignmentResponse } from "@/types"

export type RequireSuperAdminResult =
  | { ok: true; user: User }
  | { ok: false; response: NextResponse }

/**
 * Ensures the current request is authenticated and the user has the SUPER_ADMIN role.
 * Use at the start of admin API route handlers for consistent auth and authorization.
 *
 * @param supabase - Server Supabase client (from createClient())
 * @returns Either { ok: true, user } or { ok: false, response } with 401/403 already set
 */
export async function requireSuperAdmin(
  supabase: SupabaseClient,
): Promise<RequireSuperAdminResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    }
  }

  const { data: roleData, error: roleError } = await supabase
    .from("role_assignments")
    .select("roles:roles!role_assignments_role_id_fkey(name)")
    .eq("user_id", user.id)

  const typedRoleData = roleData as unknown as RoleAssignmentResponse
  const hasSuperAdminRole = typedRoleData?.some(
    (assignment) => assignment.roles.name === "SUPER_ADMIN",
  )

  if (roleError || !roleData || !hasSuperAdminRole) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    }
  }

  return { ok: true, user }
}
