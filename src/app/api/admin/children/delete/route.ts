import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function DELETE(request: Request) {
  try {
    const { sponsorshipId } = await request.json();
    const supabase = await createClient();

    const { error: activitiesError } = await supabase
      .from("sponsorship_activities")
      .delete()
      .eq('sponsorship_id', sponsorshipId);

    if (activitiesError) {
      return NextResponse.json({ error: activitiesError.message }, { status: 500 });
    }

    const { error: subscriptionsError } = await supabase
      .from("subscriptions")
      .delete()
      .eq('sponsorship_id', sponsorshipId);

    if (subscriptionsError) {
      return NextResponse.json({ error: subscriptionsError.message }, { status: 500 });
    }

    const { error: imagesError } = await supabase
      .from("sponsor_people_images")
      .delete()
      .eq('sponsor_people_id', sponsorshipId);

    if (imagesError) {
      return NextResponse.json({ error: imagesError.message }, { status: 500 });
    }

    const { error } = await supabase
      .from("sponsor_people")
      .delete()
      .eq('id', sponsorshipId);

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
