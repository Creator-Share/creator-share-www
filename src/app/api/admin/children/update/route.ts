import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function PUT(request: Request) {
  try {
    const updatedChild = await request.json();
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from("sponsor_people")
      .update(updatedChild)
      .eq('id', updatedChild.id)
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error updating child:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
} 