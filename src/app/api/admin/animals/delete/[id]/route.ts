import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { id } = await context.params;

    // Only delete if beneficiary_type is ANIMAL
    const { error } = await supabase
      .from("beneficiaries")
      .delete()
      .eq("id", id)
      .eq("beneficiary_type", "ANIMAL");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting animal beneficiary:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
