import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
// import { SponsorshipImage } from "@/types";

export async function POST(req: Request) {
  try {
    const { images } = await req.json();
    const supabase = await createClient();

    if (!Array.isArray(images)) {
      return NextResponse.json(
        { error: "Images must be an array" },
        { status: 400 }
      );
    }

    // Validate each image record
    for (const image of images) {
      if (!image.sponsorship_id || !image.image_url) {
        return NextResponse.json(
          { error: "Each image must have sponsorship_id and image_url" },
          { status: 400 }
        );
      }
    }

    // Insert all image records
    const { data, error } = await supabase
      .from("sponsorship_images")
      .insert(images)
      .select();

    if (error) {
      console.error("Error creating image records:", error);
      return NextResponse.json(
        { error: "Failed to create image records" },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
