import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function DELETE(req: Request) {
  try {
    const { imageId } = await req.json();
    const supabase = await createClient();

    // Get image details first to get the URL
    const { data: image, error: fetchError } = await supabase
      .from("sponsorship_images")
      .select("image_url")
      .eq("id", imageId)
      .single();

    if (fetchError) {
      console.error("Error fetching image:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch image details" },
        { status: 500 }
      );
    }

    if (!image) {
      return NextResponse.json(
        { error: "Image not found" },
        { status: 404 }
      );
    }

    // Delete the image record from the database
    const { error: deleteError } = await supabase
      .from("sponsorship_images")
      .delete()
      .eq("id", imageId);

    if (deleteError) {
      console.error("Error deleting image:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete image" },
        { status: 500 }
      );
    }

    // Extract file path from URL
    const urlParts = image.image_url.split("/");
    const filePath = urlParts.slice(urlParts.indexOf("sponsorships") + 1).join("/");

    // Delete the actual file from storage
    const { error: storageError } = await supabase.storage
      .from("sponsorships")
      .remove([filePath]);

    if (storageError) {
      console.error("Error deleting file from storage:", storageError);
      // We don't return an error here since the database record is already deleted
      // and the file might have been already deleted or moved
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
