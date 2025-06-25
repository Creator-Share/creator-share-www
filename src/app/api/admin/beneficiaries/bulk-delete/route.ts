import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  try {
    const { ids } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "No IDs provided" }, { status: 400 });
    }

    // First, delete related activities
    const { error: activitiesError } = await supabase
      .from("activities")
      .delete()
      .in("been", ids)

    if (activitiesError) {
      return NextResponse.json({ error: activitiesError.message }, { status: 400 });
    }

    // Then, delete beneficiaries
    const { error } = await supabase
      .from("beneficiaries")
      .delete()
      .in("id", ids)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
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
