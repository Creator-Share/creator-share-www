import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const beneficiary_id = searchParams.get("beneficiary_id");

  const supabase = await createClient();
  let query = supabase.from("activities").select("*").order("created_at", { ascending: false });

  if (beneficiary_id) {
    query = query.eq("beneficiary_id", beneficiary_id);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ activities: data || [] });
}
