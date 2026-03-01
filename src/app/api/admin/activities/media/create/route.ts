import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { getStorageKey } from "@/utils/supabase/media"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import type { Database } from "@/lib/types/db.types"

type MediaRow = Database["public"]["Tables"]["media"]["Row"]

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

interface MediaInput {
  type: "IMAGE" | "VIDEO" | "DOCUMENT"
  extension: string
  contentType: string
}

/**
 * POST /api/admin/activities/media/create
 *
 * Accepts a JSON body (NOT FormData) so that no binary file bytes pass
 * through the Next.js server – completely bypassing Vercel's 4.5 MB body
 * limit.  The client uploads the actual files directly to Supabase Storage
 * using the storage keys returned here.
 *
 * Request body:
 *   { activityId: string, media: Array<{ type, extension, contentType }> }
 *
 * Response:
 *   { media: Array<{ id, storageKey, type, contentType }> }
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      activityId: string
      media: MediaInput[]
    }
    const { activityId, media } = body

    if (!activityId) {
      return NextResponse.json(
        { error: "Missing activityId" },
        { status: 400 },
      )
    }
    if (!Array.isArray(media) || media.length === 0) {
      return NextResponse.json(
        { error: "Missing or empty media array" },
        { status: 400 },
      )
    }

    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response

    const results: Array<{
      id: string
      storageKey: string
      type: string
      contentType: string
    }> = []

    for (const item of media) {
      const { type, extension, contentType } = item
      const normalizedExt = extension.replace(/^\./, "").toLowerCase()

      const { data: mediaInserted, error: mediaInsertErr } = await supabase
        .from("media")
        .insert([{ parent_id: activityId, extension: normalizedExt, type }])
        .select()
        .single()

      if (mediaInsertErr || !mediaInserted) {
        console.error(
          "❌ [ACTIVITY MEDIA] DB insert failed:",
          mediaInsertErr,
        )
        continue
      }

      const mediaRow = mediaInserted as MediaRow
      const storageKey = getStorageKey(mediaRow)

      results.push({
        id: mediaRow.id,
        storageKey,
        type: mediaRow.type as string,
        contentType,
      })
    }

    return NextResponse.json({ media: results }, { status: 200 })
  } catch (err: unknown) {
    console.error("❌ [ACTIVITY MEDIA] Fatal error:", err)
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
