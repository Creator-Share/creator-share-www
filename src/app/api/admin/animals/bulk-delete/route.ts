import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { animalIds } = await req.json();

    if (!Array.isArray(animalIds) || animalIds.length === 0) {
      return NextResponse.json({ error: "No animal IDs provided" }, { status: 400 });
    }

    const { error } = await supabase
      .from("beneficiaries")
      .delete()
      .in("id", animalIds)
      .eq("beneficiary_type", "ANIMAL");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error bulk deleting animals:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
