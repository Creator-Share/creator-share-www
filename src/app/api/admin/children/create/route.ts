import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const formData = await request.json();
    const supabase = await createClient();
    
    const { data: newChild, error: supabaseError } = await supabase
      .from("sponsor_people")
      .insert([formData])
      .select()
      .single();

    if (supabaseError) {
      return NextResponse.json({ error: supabaseError.message }, { status: 500 });
    }

    return NextResponse.json(newChild);
  } catch (error) {
    console.error("Error creating child:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
} 