import { NextResponse } from "next/server"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { deleteFile, filterExistingMediaRows, MediaRow } from "@/utils/supabase/media"

// GET: Retrieve all images for a beneficiary by beneficiary_id
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response
  const { id } = await params
  const beneficiary_id = id
  try {
    const { data, error } = await supabase
      .from("media")
      .select("*")
      .eq("parent_id", beneficiary_id)
      .order("weight")

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    const serviceSupabase = createServiceRoleClient()
    const existing = await filterExistingMediaRows(serviceSupabase, (data || []) as unknown as MediaRow[])

    return NextResponse.json(existing, { status: 200 })
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

// DELETE: Delete an image by its id (also remove file from storage)
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response
  const { id } = await params
  const image_id = id
  try {
    // Fetch the media row to determine storage key
    const { data: mediaRow, error: fetchErr } = await supabase
      .from("media")
      .select("id, parent_id, type, extension")
      .eq("id", image_id)
      .single()

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 400 })
    }

    try {
      const { error: storageError } = await deleteFile(
        supabase,
        mediaRow as unknown as MediaRow,
      )
      if (storageError) {
        console.error("Storage delete error:", storageError)
        // continue to DB deletion even if storage delete failed
      }
    } catch (e) {
      console.error("Unexpected storage delete error:", e)
    }

    const { error } = await supabase.from("media").delete().eq("id", image_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
