import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

// DELETE /api/admin/activities/delete
export async function DELETE(req: NextRequest) {
  const body = await req.json()
  const id = body.id
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 })
  }

  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response

  const { data, error } = await supabase
    .from("activities")
    .delete()
    .eq("id", id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ activity: data })
}
