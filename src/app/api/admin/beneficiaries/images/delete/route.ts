import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { deleteFile, MediaRow } from "@/utils/supabase/media"

export async function DELETE(req: Request) {
  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response
  const { imageId } = await req.json()


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


    // Delete from storage using centralized helper
    try {
      
      const { error: storageError } = await deleteFile(
        supabase,
        mediaRow as unknown as MediaRow,
      )
      if (storageError) {
        // Log but continue to attempt DB deletion
        console.error("Storage delete error:", storageError)
      } else {
      }
    } catch (storageErr) {
      console.error("Unexpected storage delete error:", storageErr)
    }

    // Delete the database record
    const { data: deletedData, error: deleteError } = await supabase
      .from("media")
      .delete()
      .eq("id", imageId)
      .select()


    if (deleteError) {
      console.error('Database delete error:', deleteError)
      return NextResponse.json({ error: deleteError.message }, { status: 400 })
    }

    if (!deletedData || deletedData.length === 0) {
      console.warn('No records were deleted - record might not exist or RLS is blocking deletion')
      return NextResponse.json({ error: 'No records deleted - record may not exist or access denied' }, { status: 400 })
    }

    return NextResponse.json({ success: true, deletedCount: deletedData.length }, { status: 200 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error('Unexpected error in delete:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
