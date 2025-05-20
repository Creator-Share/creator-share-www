import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.pathname.split('/').pop();
    console.log("Fetching images for beneficiary ID:", id);
    
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from("media")
      .select("*")
      .eq("beneficiary_id", id)
      .order("created_at");

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("Images found:", data?.length || 0);
    if (data && data.length > 0) {
      console.log("First image:", data[0]);
    }

    return NextResponse.json(data || []);
  } catch (error) {
    console.error("Error fetching images:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
