import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function DELETE(request: Request) {
  try {
    const { beneficiaryId, childId } = await request.json();
    const id = beneficiaryId || childId;
    if (!id) {
      return NextResponse.json({ error: "Missing beneficiaryId or childId" }, { status: 400 });
    }
    const supabase = await createClient();

    const { error: activitiesError } = await supabase
      .from("activities")
      .delete()
      .eq('beneficiary_id', id);

    if (activitiesError) {
      return NextResponse.json({ error: activitiesError.message }, { status: 500 });
    }

    const { error: subscriptionsError } = await supabase
      .from("subscriptions")
      .delete()
      .eq('beneficiary_id', id);

    if (subscriptionsError) {
      return NextResponse.json({ error: subscriptionsError.message }, { status: 500 });
    }

    const { error: imagesError } = await supabase
      .from("media")
      .delete()
      .eq('beneficiary_id', id);

    if (imagesError) {
      return NextResponse.json({ error: imagesError.message }, { status: 500 });
    }

    const { error } = await supabase
      .from("beneficiaries")
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting child:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
