import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { MediaRow, uploadFile } from "@/utils/supabase/media"

export async function PUT(req: NextRequest) {
  console.log("🔄 [UPDATE ACTIVITY] Starting activity update")
  
  const formData = await req.formData()
  const id = formData.get("id") as string | null
  const title = formData.get("title") as string | null
  const description = formData.get("description") as string | null
  const activity_type = formData.get("activity_type") as string | null
  const is_public = formData.get("is_public") === "true"
  const beneficiary_id = formData.get("beneficiary_id") as string | null
  
  // Get existing media that should be kept
  const existingImagesStr = formData.get("existing_images") as string | null
  const existingVideosStr = formData.get("existing_videos") as string | null
  const existingImages: string[] = existingImagesStr ? JSON.parse(existingImagesStr) : []
  const existingVideos: string[] = existingVideosStr ? JSON.parse(existingVideosStr) : []

  console.log("📝 [UPDATE ACTIVITY] Form data:", {
    id,
    title,
    description: description?.substring(0, 50) + "...",
    activity_type,
    is_public,
    beneficiary_id,
    existingImages: existingImages.length,
    existingVideos: existingVideos.length,
  })

  if (!id || !description || !beneficiary_id) {
    console.error("❌ [UPDATE ACTIVITY] Missing required fields")
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    )
  }

  // Extract new media files
  const images: File[] = []
  const videos: File[] = []
  for (const [key, value] of formData.entries()) {
    if (value instanceof File && value.size > 0) {
      if (key === "images") images.push(value)
      if (key === "videos") videos.push(value)
    }
  }

  const supabase = await createClient()

  // Update activity record
  const updateData: {
    title?: string
    description: string
    activity_type?: string
    is_public?: boolean
  } = {
    description,
  }
  
  if (title) updateData.title = title
  if (activity_type) updateData.activity_type = activity_type
  if (is_public !== undefined) updateData.is_public = is_public

  console.log("💾 [UPDATE ACTIVITY] Updating activity in database")

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

  console.log("✅ [UPDATE ACTIVITY] Activity updated successfully")

  // Handle media updates
  // Step 1: Fetch all existing media for this activity
  const { data: allExistingMedia, error: mediaFetchError } = await supabase
    .from("media")
    .select("*")
    .eq("parent_id", id)

  if (mediaFetchError) {
    console.error("❌ [UPDATE ACTIVITY] Error fetching existing media:", mediaFetchError)
  }

  // Step 2: Delete media that was removed (not in existingImages/existingVideos)
  if (allExistingMedia && allExistingMedia.length > 0) {
    const { getStorageKey } = await import("@/utils/supabase/media")
    const { STORAGE_BUCKET } = await import("@/utils/supabase/buckets")
    
    // Build public URLs from existing media records to compare
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!base) {
      console.error("❌ NEXT_PUBLIC_SUPABASE_URL not set")
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    }
    const normalizedBase = base.replace(/\/$/, "")

    for (const mediaRecord of allExistingMedia) {
      const key = getStorageKey(mediaRecord as unknown as MediaRow)
      const publicUrl = `${normalizedBase}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeURI(key)}`
      
      const isImage = mediaRecord.type === "IMAGE"
      const isVideo = mediaRecord.type === "VIDEO"
      const shouldKeep = 
        (isImage && existingImages.includes(publicUrl)) ||
        (isVideo && existingVideos.includes(publicUrl))

      if (!shouldKeep) {
        console.log("🗑️ [UPDATE ACTIVITY] Removing media:", mediaRecord.id)
        
        // Delete from storage
        const { error: storageError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove([key])
        
        if (storageError) {
          console.error("❌ [UPDATE ACTIVITY] Error deleting from storage:", storageError)
        }

        // Delete from database
        const { error: dbError } = await supabase
          .from("media")
          .delete()
          .eq("id", mediaRecord.id)
        
        if (dbError) {
          console.error("❌ [UPDATE ACTIVITY] Error deleting media record:", dbError)
        }
      }
    }
  }

  // Step 3: Upload new media files
  const imageMediaIds: string[] = []
  for (const file of images) {
    const ext = (file.name.split(".").pop() || "").toLowerCase()

    // Insert media row for this image
    const { data: mediaInserted, error: mediaInsertErr } = await supabase
      .from("media")
      .insert([{ parent_id: id, extension: ext, type: "IMAGE" }])
      .select()
      .single()

    if (mediaInsertErr) {
      console.error("❌ [UPDATE ACTIVITY] Image media insert failed:", mediaInsertErr)
      continue
    }

    const mediaRow = mediaInserted as unknown as MediaRow

    // Upload using centralized helper
    try {
      const { error: uploadErr } = await uploadFile(supabase, mediaRow, file, {
        contentType: file.type,
      })
      if (uploadErr) {
        console.error("❌ [UPDATE ACTIVITY] Image upload error:", uploadErr)
      }
    } catch (e) {
      console.error("❌ [UPDATE ACTIVITY] Unexpected error uploading image:", e)
    }

    imageMediaIds.push(mediaRow.id)
  }

  const videoMediaIds: string[] = []
  for (const file of videos) {
    const ext = (file.name.split(".").pop() || "").toLowerCase()

    // Insert media row for this video
    const { data: mediaInserted, error: mediaInsertErr } = await supabase
      .from("media")
      .insert([{ parent_id: id, extension: ext, type: "VIDEO" }])
      .select()
      .single()

    if (mediaInsertErr) {
      console.error("❌ [UPDATE ACTIVITY] Video media insert failed:", mediaInsertErr)
      continue
    }

    const mediaRow = mediaInserted as unknown as MediaRow

    try {
      const { error: uploadErr } = await uploadFile(supabase, mediaRow, file, {
        contentType: file.type,
      })
      if (uploadErr) {
        console.error("❌ [UPDATE ACTIVITY] Video upload error:", uploadErr)
      }
    } catch (e) {
      console.error("❌ [UPDATE ACTIVITY] Unexpected error uploading video:", e)
    }

    videoMediaIds.push(mediaRow.id)
  }

  console.log("📸 [UPDATE ACTIVITY] Media uploaded:", {
    images: imageMediaIds.length,
    videos: videoMediaIds.length
  })

  console.log("🎉 [UPDATE ACTIVITY] Activity updated successfully")
  return NextResponse.json({ activity: updated })
}
