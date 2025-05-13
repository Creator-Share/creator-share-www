import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: Request) {
  try {
    const { sponsorshipIds } = await req.json();
    const supabase = await createClient();

    // Delete images first
    const { error: imagesError } = await supabase
      .from("sponsorship_images")
      .delete()
      .in("sponsorship_id", sponsorshipIds);

    if (imagesError) {
      console.error("Error deleting images:", imagesError);
      return NextResponse.json(
        { error: "Failed to delete sponsorship images" },
        { status: 500 }
      );
    }

    // Delete activities
    const { error: activitiesError } = await supabase
      .from("people_activities")
      .delete()
      .in("sponsorship_id", sponsorshipIds);

    if (activitiesError) {
      console.error("Error deleting activities:", activitiesError);
      return NextResponse.json(
        { error: "Failed to delete activities" },
        { status: 500 }
      );
    }

    // Delete subscriptions
    const { error: subscriptionsError } = await supabase
      .from("subscriptions")
      .delete()
      .in("sponsorship_id", sponsorshipIds);

    if (subscriptionsError) {
      console.error("Error deleting subscriptions:", subscriptionsError);
      return NextResponse.json(
        { error: "Failed to delete subscriptions" },
        { status: 500 }
      );
    }

    // Delete transactions
    const { error: transactionsError } = await supabase
      .from("transaction_ledger")
      .delete()
      .in("sponsorship_id", sponsorshipIds);

    if (transactionsError) {
      console.error("Error deleting transactions:", transactionsError);
      return NextResponse.json(
        { error: "Failed to delete transactions" },
        { status: 500 }
      );
    }

    // Delete child details
    const { error: childDetailsError } = await supabase
      .from("child_details")
      .delete()
      .in("sponsorship_id", sponsorshipIds);

    if (childDetailsError) {
      console.error("Error deleting child details:", childDetailsError);
      return NextResponse.json(
        { error: "Failed to delete child details" },
        { status: 500 }
      );
    }

    // Finally delete sponsorships
    const { error: sponsorshipsError } = await supabase
      .from("sponsorships")
      .delete()
      .in("id", sponsorshipIds);

    if (sponsorshipsError) {
      console.error("Error deleting sponsorships:", sponsorshipsError);
      return NextResponse.json(
        { error: "Failed to delete sponsorships" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
