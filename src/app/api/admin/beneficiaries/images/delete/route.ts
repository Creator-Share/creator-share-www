import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { deleteFile, getStorageKey, MediaRow } from "@/utils/supabase/media"
import { STORAGE_BUCKET } from "@/utils/supabase/buckets"

export async function DELETE(req: Request) {
  const supabase = await createClient()
  const { imageId } = await req.json()

  console.log('Delete request received for imageId:', imageId)

  try {
    // Fetch the media row (we rely on parent_id/type/extension for storage key)
    const { data: mediaRow, error: fetchError } = await supabase
      .from("media")
      .select("id, parent_id, type, extension")
      .eq("id", imageId)
      .single()

    if (fetchError) {
      console.error('Error fetching media row:', fetchError)
      return NextResponse.json({ error: fetchError.message }, { status: 400 })
    }

    console.log('Found media row:', mediaRow)

    // Delete from storage using centralized helper
    try {
      const storagePath = getStorageKey(mediaRow as unknown as MediaRow)
      console.log('Storage path to delete:', storagePath)
      console.log('Full storage path:', `${STORAGE_BUCKET}/${storagePath}`)
      
      const { error: storageError, data: storageData } = await deleteFile(
        supabase,
        mediaRow as unknown as MediaRow,
      )
      if (storageError) {
        // Log but continue to attempt DB deletion
        console.error("Storage delete error:", storageError)
      } else {
        console.log('Successfully deleted from storage, data:', storageData)
      }
    } catch (storageErr) {
      console.error("Unexpected storage delete error:", storageErr)
    }

    // Delete the database record
    console.log('Deleting media record with ID:', imageId)
    const { data: deletedData, error: deleteError, count } = await supabase
      .from("media")
      .delete()
      .eq("id", imageId)
      .select()

    console.log('Delete query result:', { deletedData, deleteError, count })

    if (deleteError) {
      console.error('Database delete error:', deleteError)
      return NextResponse.json({ error: deleteError.message }, { status: 400 })
    }

    if (!deletedData || deletedData.length === 0) {
      console.warn('No records were deleted - record might not exist or RLS is blocking deletion')
      return NextResponse.json({ error: 'No records deleted - record may not exist or access denied' }, { status: 400 })
    }

    console.log('Successfully deleted media record with ID:', imageId)
    return NextResponse.json({ success: true, deletedCount: deletedData.length }, { status: 200 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error('Unexpected error in delete:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
