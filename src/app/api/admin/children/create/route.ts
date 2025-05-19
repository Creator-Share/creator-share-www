import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const formData = await request.json();


    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError) {
      console.error("Auth error:", authError);
      return NextResponse.json({ error: "Authentication error" }, { status: 401 });
    }

    const { data: newBeneficiary, error: supabaseError } = await supabase
      .from("beneficiaries")
      .insert([formData])
      .select()
      .single();

    if (supabaseError) {
      return NextResponse.json({ error: supabaseError.message }, { status: 500 });
    }

    const { error: activityError } = await supabase
      .from("activities")
      .insert({
        title: `Beneficiary Added`,
        description: `${newBeneficiary.name} was added`,
        beneficiary_id: newBeneficiary.id,
        user_id: user?.id
      });

    if (activityError) {
      console.error("Error creating activity:", activityError);
    }

    return NextResponse.json(newBeneficiary);
  } catch (error) {
    console.error("Error creating child:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
