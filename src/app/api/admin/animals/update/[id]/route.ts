import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const body = await req.json();
    const { id } = await context.params;
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
    } = body;

    const metadata = {
      breed,
      animal_type,
    };

    const { data, error } = await supabase
      .from("beneficiaries")
      .update({
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
        metadata,
      })
      .eq("id", id)
      .eq("beneficiary_type", "ANIMAL")
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ animal: data });
  } catch (error) {
    console.error("Error updating animal beneficiary:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
