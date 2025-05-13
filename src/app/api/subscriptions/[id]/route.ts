import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type Params = Promise<{ id: string }>;

export async function GET(
  req: Request,
  segmentData: { params: Params }
) {
  try {
    const supabase = await createClient();
    const params = await segmentData.params;
    const id = params.id;

    const { data: subscriptions, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("sponsorship_id", id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching subscriptions:", error);
      return NextResponse.json(
        { error: "Failed to fetch subscriptions" },
        { status: 500 }
      );
    }

    return NextResponse.json({ subscriptions: subscriptions || [] });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
