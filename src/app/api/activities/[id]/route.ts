// src/app/api/activities/[id]/route.ts

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.pathname.split("/").pop();

    if (!id) {
      return NextResponse.json({ error: "Missing ID in path" }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: activities, error } = await supabase
      .from("people_activities")
      .select("*")
      .eq("sponsorship_id", id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching activities:", error);
      return NextResponse.json(
        { error: "Failed to fetch activities" },
        { status: 500 }
      );
    }

    return NextResponse.json({ activities: activities || [] });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
