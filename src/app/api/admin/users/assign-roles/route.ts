import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import {
  replaceCreatorShareRoles,
  roleChangeReason,
} from "@/utils/admin/creatorShareRoles"

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response

    const { userId, roleIds, reason } = await request.json()

    if (!userId || !roleIds || !Array.isArray(roleIds)) {
      return NextResponse.json({ error: "User ID and Role IDs array are required" }, { status: 400 })
    }

    const roles = await replaceCreatorShareRoles(
      supabase,
      randomUUID(),
      userId,
      roleIds,
      roleChangeReason(reason, "Administrator replaced Creator Share roles"),
    )

    return NextResponse.json({ 
      message: "User roles updated successfully",
      user: { id: userId },
      roles,
    })
  } catch (error) {
    console.error("Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
