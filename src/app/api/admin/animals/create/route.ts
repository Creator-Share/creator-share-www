import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const body = await req.json();

    // Extract animal-specific fields from body
    const {
      name,
      biography,
      country,
      location_str,
      gender,
      video_url,
      introduction,
      budget_goal,
      status,
      username,
      breed,
      animal_type,
      // ...other fields as needed
    } = body;

    // Compose metadata for animal-specific fields
    const metadata = {
      breed,
      animal_type,
    };

    const { data, error } = await supabase
      .from("beneficiaries")
      .insert([
        {
          name,
          biography,
          country,
          location_str,
          gender,
          video_url,
          introduction,
          budget_goal,
          status,
          username,
          beneficiary_type: "ANIMAL",
          metadata,
        },
      ])
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ animal: data });
  } catch (error) {
    console.error("Error creating animal beneficiary:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
