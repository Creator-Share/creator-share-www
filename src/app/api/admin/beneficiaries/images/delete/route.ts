import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { deleteFile, MediaRow } from "@/utils/supabase/media";

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { imageId } = await req.json();

  try {
    // Fetch the media row (we rely on parent_id/type/extension for storage key)
    const { data: mediaRow, error: fetchError } = await supabase
      .from("media")
      .select("id, parent_id, type, extension")
      .eq("id", imageId)
      .single();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 400 });
    }

    // Delete from storage using centralized helper
    try {
      const { error: storageError } = await deleteFile(supabase, mediaRow as unknown as MediaRow);
      if (storageError) {
        // Log but continue to attempt DB deletion
        console.error("Storage delete error:", storageError);
      }
    } catch (storageErr) {
      console.error("Unexpected storage delete error:", storageErr);
    }

    // Delete the database record
    const { error: deleteError } = await supabase
      .from("media")
      .delete()
      .eq("id", imageId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
