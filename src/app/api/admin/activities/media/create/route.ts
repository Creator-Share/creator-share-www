import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { uploadFile } from "@/utils/supabase/media"
import type { Database } from "@/lib/types/db.types"

type MediaRow = Database["public"]["Tables"]["media"]["Row"]

// Configure route for handling large file uploads
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Set max duration for long-running uploads (important for large videos)
export const maxDuration = 300 // 5 minutes max

export async function POST(req: Request) {
  console.log("📤 [ACTIVITY MEDIA] Starting media upload")
  
  try {
    const formData = await req.formData()
    const activityId = formData.get("activityId") as string | null

    if (!activityId) {
      return NextResponse.json(
        { error: "Missing activityId" },
        { status: 400 },
      )
    }

    const supabase = await createClient()

    // Collect all uploaded media IDs
    const uploadedMediaIds: string[] = []

    // Process images
    const imageFiles: File[] = []
    for (const [key, value] of formData.entries()) {
      if (key === "images" && value instanceof File && value.size > 0) {
        imageFiles.push(value)
      }
    }

    console.log(`📷 [ACTIVITY MEDIA] Processing ${imageFiles.length} images`)

    for (const file of imageFiles) {
      const ext = (file.name.split(".").pop() || "").toLowerCase()

      // Insert media row for this image
      const { data: mediaInserted, error: mediaInsertErr } = await supabase
        .from("media")
        .insert([{ parent_id: activityId, extension: ext, type: "IMAGE" }])
        .select()
        .single()

      if (mediaInsertErr) {
        console.error("❌ [ACTIVITY MEDIA] Image insert failed:", mediaInsertErr)
        continue
      }

      const mediaRow = mediaInserted as MediaRow

      // Upload using centralized helper
      try {
        const { error: uploadErr } = await uploadFile(supabase, mediaRow, file, {
          contentType: file.type,
        })
        if (uploadErr) {
          console.error("❌ [ACTIVITY MEDIA] Image upload error:", uploadErr)
        } else {
          uploadedMediaIds.push(mediaRow.id)
        }
      } catch (e) {
        console.error("❌ [ACTIVITY MEDIA] Unexpected error uploading image:", e)
      }
    }

    // Process videos
    const videoFiles: File[] = []
    for (const [key, value] of formData.entries()) {
      if (key === "videos" && value instanceof File && value.size > 0) {
        videoFiles.push(value)
      }
    }

    console.log(`🎥 [ACTIVITY MEDIA] Processing ${videoFiles.length} videos`)

    for (const file of videoFiles) {
      const ext = (file.name.split(".").pop() || "").toLowerCase()

      // Insert media row for this video
      const { data: mediaInserted, error: mediaInsertErr } = await supabase
        .from("media")
        .insert([{ parent_id: activityId, extension: ext, type: "VIDEO" }])
        .select()
        .single()

      if (mediaInsertErr) {
        console.error("❌ [ACTIVITY MEDIA] Video insert failed:", mediaInsertErr)
        continue
      }

      const mediaRow = mediaInserted as MediaRow

      try {
        const { error: uploadErr } = await uploadFile(supabase, mediaRow, file, {
          contentType: file.type,
        })
        if (uploadErr) {
          console.error("❌ [ACTIVITY MEDIA] Video upload error:", uploadErr)
        } else {
          uploadedMediaIds.push(mediaRow.id)
        }
      } catch (e) {
        console.error("❌ [ACTIVITY MEDIA] Unexpected error uploading video:", e)
      }
    }

    console.log(`✅ [ACTIVITY MEDIA] Successfully uploaded ${uploadedMediaIds.length} media files`)

    return NextResponse.json(
      { 
        success: true, 
        uploadedCount: uploadedMediaIds.length,
        mediaIds: uploadedMediaIds 
      },
      { status: 200 },
    )
  } catch (err: unknown) {
    console.error("❌ [ACTIVITY MEDIA] Fatal error:", err)
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
