import type { SupabaseClient } from "@supabase/supabase-js"

export interface CreatorShareRole {
  role_id: string
  role_name: string
}

export function roleChangeReason(
  suppliedReason: unknown,
  fallback: string,
): string {
  if (typeof suppliedReason === "string" && suppliedReason.trim()) {
    return suppliedReason.trim()
  }
  return fallback
}

export async function getCreatorShareRoleIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("role_assignments")
    .select("role_id")
    .eq("user_id", userId)
    .is("organization_id", null)
    .is("advocate_id", null)

  if (error) throw error

  return (data ?? []).map((assignment) => String(assignment.role_id))
}

export async function replaceCreatorShareRoles(
  supabase: SupabaseClient,
  request: Request,
  userId: string,
  roleIds: string[],
  reason: string,
): Promise<CreatorShareRole[]> {
  const { data, error } = await supabase.rpc(
    "replace_creator_share_user_roles",
    {
      target_user_id: userId,
      target_role_ids: roleIds,
      change_reason: reason,
      request_id: request.headers.get("x-request-id"),
    },
  )

  if (error) throw error
  return (data ?? []) as CreatorShareRole[]
}
