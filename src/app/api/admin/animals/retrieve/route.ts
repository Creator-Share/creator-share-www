import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: fetchedData, error } = await supabase
      .from("beneficiaries")
      .select("*")
      .eq("beneficiary_type", "ANIMAL");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Animal-specific fields are in metadata
    const formattedData = fetchedData.map((animal) => ({
      ...animal,
      budget_goal: (animal.budget_goal / 100).toFixed(2),
      breed: animal.metadata?.breed || null,
      animal_type: animal.metadata?.animal_type || null,
    }));

    return NextResponse.json({ animals: formattedData });
  } catch (error) {
    console.error("Error retrieving animals:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
