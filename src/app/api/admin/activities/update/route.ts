import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// PUT /api/admin/activities/update
export async function PUT(req: NextRequest) {
  const data = await req.json();
  const { id, description } = data;
  if (!id || !description) {
    return NextResponse.json({ error: "Missing id or description" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("activities")
    .update({ description })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ activity: updated });
}
