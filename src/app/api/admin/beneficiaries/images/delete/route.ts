import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { imageId } = await req.json();

  try {
    // First get the image record to get its URL
    const { data: imageData, error: fetchError } = await supabase
      .from("media")
      .select("image_url")
      .eq("id", imageId)
      .single();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 400 });
    }

    // Delete from storage if URL exists
    if (imageData?.image_url) {
      const urlParts = imageData.image_url.split("/");
      const fileName = urlParts[urlParts.length - 1];
      const { error: storageError } = await supabase.storage
        .from("beneficiaries")
        .remove([`images/${fileName}`]);

      if (storageError) {
        console.error("Storage delete error:", storageError);
      }
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
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
