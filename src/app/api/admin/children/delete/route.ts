import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function DELETE(request: Request) {
  try {
    const { childId } = await request.json();
    const supabase = await createClient();

    const { error: activitiesError } = await supabase
      .from("people_activities")
      .delete()
      .eq('child_id', childId);

    if (activitiesError) {
      return NextResponse.json({ error: activitiesError.message }, { status: 500 });
    }

    const { error: subscriptionsError } = await supabase
      .from("subscriptions")
      .delete()
      .eq('child_id', childId);

    if (subscriptionsError) {
      return NextResponse.json({ error: subscriptionsError.message }, { status: 500 });
    }

    const { error: imagesError } = await supabase
      .from("media")
      .delete()
      .eq('beneficiary_id', childId);

    if (imagesError) {
      return NextResponse.json({ error: imagesError.message }, { status: 500 });
    }

    const { error } = await supabase
      .from("sponsor_people")
      .delete()
      .eq('id', childId);

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
