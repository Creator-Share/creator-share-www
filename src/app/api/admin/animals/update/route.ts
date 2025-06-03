import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, video_url } = body;

    if (!id || !video_url) {
      return NextResponse.json({ error: "Missing id or video_url" }, { status: 400 });
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("beneficiaries")
      .update({ video_url })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
