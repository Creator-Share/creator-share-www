import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import {
  getCreatorShareRoleIds,
  replaceCreatorShareRoles,
  roleChangeReason,
} from "@/utils/admin/creatorShareRoles"

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response

    const { userId, roleId, reason } = await request.json()

    if (!userId || !roleId) {
      return NextResponse.json(
        { error: "userId and roleId are required" },
        { status: 400 }
      )
    }

    const currentRoleIds = await getCreatorShareRoleIds(supabase, userId)
    const roles = await replaceCreatorShareRoles(
      supabase,
      request,
      userId,
      currentRoleIds.filter((currentRoleId) => currentRoleId !== roleId),
      roleChangeReason(reason, "Administrator removed a Creator Share role"),
    )

    return NextResponse.json({ message: "Role removed successfully", roles })
  } catch (error) {
    console.error("Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
