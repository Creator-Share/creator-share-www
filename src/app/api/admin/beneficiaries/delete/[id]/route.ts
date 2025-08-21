import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { id } = await params;
  try {
    const { error: activitiesError } = await supabase
      .from("activities")
      .delete()
      .eq("beneficiary_id", id);

    if (activitiesError) {
      return NextResponse.json({ error: activitiesError.message }, { status: 400 });
    }

    // Then, delete the beneficiary
    const { error } = await supabase
      .from("beneficiaries")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
