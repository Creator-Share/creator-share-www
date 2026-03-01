import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { MediaRow } from "@/utils/supabase/media"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * PUT /api/admin/activities/update
 *
 * Accepts a JSON body (NOT FormData).  File uploads are now handled
 * client-side via direct Supabase Storage uploads, so this route only needs
 * to:
 *   1. Update the activity DB record.
 *   2. Delete media records (and storage objects) that were removed.
 *
 * Request body:
 *  {
 *    id: string
 *    title?: string
 *    description: string
 *    activity_type?: string
 *    is_public?: boolean
 *    beneficiary_id: string
 *    existing_images: string[]   // public URLs of images to KEEP
 *    existing_videos: string[]   // public URLs of videos to KEEP
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
    existing_images?: string[]
    existing_videos?: string[]
  }

  const {
    id,
    title,
    description,
    activity_type,
    is_public,
    beneficiary_id,
    existing_images = [],
    existing_videos = [],
  } = body

  if (!id || !description || !beneficiary_id) {
    console.error("❌ [UPDATE ACTIVITY] Missing required fields")
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response

  // ─── 1. Update activity record ────────────────────────────────────────────

  const updateData: {
    title?: string
    description: string
    activity_type?: string
    is_public?: boolean
  } = { description }

  if (title) updateData.title = title
  if (activity_type) updateData.activity_type = activity_type
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

  // ─── 2. Delete removed media ───────────────────────────────────────────────

  const { data: allExistingMedia, error: mediaFetchError } = await supabase
    .from("media")
    .select("*")
    .eq("parent_id", id)

  if (mediaFetchError) {
    console.error(
      "❌ [UPDATE ACTIVITY] Error fetching existing media:",
      mediaFetchError,
    )
  }

  if (allExistingMedia && allExistingMedia.length > 0) {
    const { getStorageKey } = await import("@/utils/supabase/media")
    const { STORAGE_BUCKET } = await import("@/utils/supabase/buckets")

    const base = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!base) {
      console.error("❌ NEXT_PUBLIC_SUPABASE_URL not set")
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 },
      )
    }
    const normalizedBase = base.replace(/\/$/, "")

    for (const mediaRecord of allExistingMedia) {
      const key = getStorageKey(mediaRecord as unknown as MediaRow)
      const publicUrl = `${normalizedBase}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeURI(key)}`

      const isImage = mediaRecord.type === "IMAGE"
      const isVideo = mediaRecord.type === "VIDEO"

      // Only auto-delete IMAGE and VIDEO records that were explicitly removed.
      // DOCUMENT records are not managed here.
      if (!isImage && !isVideo) continue

      const shouldKeep =
        (isImage && existing_images.includes(publicUrl)) ||
        (isVideo && existing_videos.includes(publicUrl))

      if (!shouldKeep) {
        const { error: storageError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove([key])

        if (storageError) {
          console.error(
            "❌ [UPDATE ACTIVITY] Error deleting from storage:",
            storageError,
          )
        }

        const { error: dbError } = await supabase
          .from("media")
          .delete()
          .eq("id", mediaRecord.id)

        if (dbError) {
          console.error(
            "❌ [UPDATE ACTIVITY] Error deleting media record:",
            dbError,
          )
        }
      }
    }
  }

  return NextResponse.json({ activity: updated })
}
