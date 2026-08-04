import { NextRequest, NextResponse } from "next/server"
import { findInvalidPublicActivityProjectionField } from "@/config/beneficiaryValidation"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * PUT /api/admin/activities/update
 *
 * Updates the text fields of an activity. Media deletion is handled
 * independently via DELETE /api/admin/activities/media/delete, so this
 * route no longer needs to diff or delete any media records.
 *
 * Request body:
 *  {
 *    id: string
 *    title?: string
 *    description: string
 *    activity_type?: string
 *    is_public?: boolean
 *    beneficiary_id: string
 *  }
 */
export async function PUT(req: NextRequest) {
  const body = (await req.json()) as {
    id?: string
    title?: string
    description?: string
    activity_type?: string
    is_public?: boolean
    beneficiary_id?: string
  }

  const { id, title, description, activity_type, is_public, beneficiary_id } =
    body

  if (!id || !description || !beneficiary_id) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    )
  }

  const invalidProjectionField = findInvalidPublicActivityProjectionField({
    title: title ?? null,
    description,
    activity_type: activity_type ?? null,
  })
  if (invalidProjectionField !== null) {
    return NextResponse.json(
      { error: `Invalid activity ${invalidProjectionField}` },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response

  const updateData: {
    description: string
    title?: string
    activity_type?: string
    is_public?: boolean
  } = { description }

  if (title !== undefined && title !== null) {
    updateData.title = title.trim() || undefined // discard empty-string titles
  }
  if (activity_type !== undefined) updateData.activity_type = activity_type
  if (is_public !== undefined) updateData.is_public = is_public

  const { data: updated, error } = await supabase
    .from("activities")
    .update(updateData)
    .eq("id", id)
    .select()
    .single()

  if (error) {
    console.error("❌ [UPDATE ACTIVITY] Failed to update activity:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ activity: updated })
}
