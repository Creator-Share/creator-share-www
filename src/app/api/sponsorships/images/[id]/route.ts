import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function extractId(req: NextRequest): string | null {
  const segments = req.nextUrl.pathname.split("/");
  return segments[segments.length - 1] || null;
}

export async function GET(req: NextRequest) {
  try {
    const sponsorshipId = extractId(req);
    if (!sponsorshipId) {
      return NextResponse.json({ error: "Missing ID" }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: images, error } = await supabase
      .from("sponsorship_images")
      .select("*")
      .eq("sponsorship_id", sponsorshipId)
      .order("order_index");

    if (error) {
      console.error("Error fetching images:", error);
      return NextResponse.json({ error: "Failed to fetch images" }, { status: 500 });
    }

    return NextResponse.json(images);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
