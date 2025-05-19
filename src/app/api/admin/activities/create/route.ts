import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// POST /api/admin/activities/create
export async function POST(req: NextRequest) {
  const data = await req.json();
  const { description, beneficiary_id, title } = data;
  if (!description || !beneficiary_id) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: inserted, error } = await supabase
    .from("activities")
    .insert([
      {
        title,
        description,
        beneficiary_id,
        created_at: new Date().toISOString(),
      },
    ])
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ activity: inserted }, { status: 201 });
}
