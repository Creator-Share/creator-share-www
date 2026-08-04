import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import {
  replaceCreatorShareRoles,
  roleChangeReason,
} from "@/utils/admin/creatorShareRoles"

export async function PUT(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response

    const { userId, roleId, reason } = await request.json()

    if (!userId || !roleId) {
      return NextResponse.json({ error: "User ID and Role ID are required" }, { status: 400 })
    }

    const roles = await replaceCreatorShareRoles(
      supabase,
      randomUUID(),
      userId,
      [roleId],
      roleChangeReason(reason, "Administrator changed a Creator Share role"),
    )

    return NextResponse.json({ 
      message: "User role updated successfully",
      user: { id: userId },
      role: roles[0] ?? null,
    })
  } catch (error) {
    console.error("Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
