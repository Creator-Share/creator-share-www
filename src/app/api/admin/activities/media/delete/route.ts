import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { MediaRow, getStorageKey } from "@/utils/supabase/media"
import { STORAGE_BUCKET } from "@/utils/supabase/buckets"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * DELETE /api/admin/activities/media/delete
 *
 * Atomically deletes a single media record: removes the file from Supabase
 * Storage and deletes the DB row. Completely decoupled from the activity
 * update flow — called immediately when the admin confirms deletion in the UI.
 *
 * Request body:
 *  {
 *    mediaUrl: string   // the public URL of the media item to delete
 *    activityId: string // parent activity — used to scope the DB lookup
 *  }
 */
export async function DELETE(req: NextRequest) {
  const body = (await req.json()) as {
    mediaUrl?: string
    activityId?: string
  }

  const { mediaUrl, activityId } = body

  if (!mediaUrl || !activityId) {
    return NextResponse.json(
      { error: "Missing required fields: mediaUrl and activityId" },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response

  // ── Fetch all media for the activity so we can match by public URL ────────
  const { data: allMedia, error: fetchError } = await supabase
    .from("media")
    .select("*")
    .eq("parent_id", activityId)

  if (fetchError) {
    console.error("❌ [MEDIA DELETE] Failed to fetch media records:", fetchError)
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!allMedia || allMedia.length === 0) {
    return NextResponse.json({ error: "No media found for this activity" }, { status: 404 })
  }

  // ── Find the record whose public URL matches mediaUrl ─────────────────────
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")
  if (!base) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 })
  }

  let targetRecord: MediaRow | null = null

  for (const record of allMedia) {
    const mediaRecord = record as unknown as MediaRow
    const key = getStorageKey(mediaRecord)

    let candidateUrl: string
    if (mediaRecord.type === "IMAGE") {
      const { data } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(key, {
          transform: { width: 800, height: 800, quality: 85, resize: "cover" },
        })
      candidateUrl = data.publicUrl
    } else {
      candidateUrl = `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeURI(key)}`
    }

    if (candidateUrl === mediaUrl) {
      targetRecord = mediaRecord
      break
    }
  }

  if (!targetRecord) {
    return NextResponse.json(
      { error: "Media record not found for the provided URL" },
      { status: 404 },
    )
  }

  const storageKey = getStorageKey(targetRecord)

  // ── Delete from storage ───────────────────────────────────────────────────
  const { error: storageError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .remove([storageKey])

  if (storageError) {
    console.error("❌ [MEDIA DELETE] Storage deletion failed:", storageError)
    return NextResponse.json({ error: storageError.message }, { status: 500 })
  }

  // ── Delete the DB record ──────────────────────────────────────────────────
  const { error: dbError } = await supabase
    .from("media")
    .delete()
    .eq("id", targetRecord.id)

  if (dbError) {
    console.error("❌ [MEDIA DELETE] DB deletion failed:", dbError)
    // Storage is already gone — log and still return success to avoid
    // leaving the UI in a broken state; the orphaned DB row is harmless.
    return NextResponse.json(
      { warning: "File deleted from storage but DB record removal failed", error: dbError.message },
      { status: 207 },
    )
  }

  return NextResponse.json({ success: true })
}
