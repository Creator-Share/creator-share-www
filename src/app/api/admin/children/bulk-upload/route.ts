import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { children } = await request.json();
    const supabase = await createClient();
    
    // Validate the data structure
    if (!Array.isArray(children) || children.length === 0) {
      return NextResponse.json(
        { error: "Invalid data format" },
        { status: 400 }
      );
    }

    // Process each child record
    const { data, error } = await supabase
      .from("sponsor_people")
      .insert(children)
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error processing bulk upload:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
} 