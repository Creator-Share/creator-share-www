import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { deleteFile, MediaRow } from "@/utils/supabase/media"

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response
  const { id } = await params
  try {
    const beneficiaryId = id

    // First, delete related activities
    const { error: activitiesError } = await supabase
      .from("activities")
      .delete()
      .eq("beneficiary_id", beneficiaryId)

    if (activitiesError) {
      return NextResponse.json(
        { error: activitiesError.message },
        { status: 400 },
      )
    }

    // Fetch media rows for this beneficiary and attempt to delete files from storage
    try {
      const { data: mediaRows, error: mediaFetchError } = await supabase
        .from("media")
        .select("id, parent_id, type, extension")
        .eq("parent_id", beneficiaryId)

      if (mediaFetchError) {
        console.error(
          "Failed to fetch media rows for beneficiary:",
          mediaFetchError,
        )
      } else if (Array.isArray(mediaRows) && mediaRows.length > 0) {
        for (const mr of mediaRows) {
          try {
            const { error: storageErr } = await deleteFile(
              supabase,
              mr as unknown as MediaRow,
            )
            if (storageErr) {
              console.error(
                "Storage delete error for media id",
                mr.id,
                storageErr,
              )
            }
          } catch (e) {
            console.error(
              "Unexpected error deleting storage for media id",
              mr.id,
              e,
            )
          }
        }

        // Remove media rows from DB
        const { error: mediaDeleteErr } = await supabase
          .from("media")
          .delete()
          .eq("parent_id", beneficiaryId)

        if (mediaDeleteErr) {
          console.error(
            "Failed to delete media rows after storage removal:",
            mediaDeleteErr,
          )
        }
      }
    } catch (e) {
      console.error("Error during media cleanup for beneficiary delete:", e)
    }

    // Finally, delete the beneficiary record
    const { error } = await supabase
      .from("beneficiaries")
      .delete()
      .eq("id", beneficiaryId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
