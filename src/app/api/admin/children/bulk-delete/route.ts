import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { childIds } = await request.json();
    const supabase = await createClient();
    
    if (!Array.isArray(childIds) || childIds.length === 0) {
      return NextResponse.json(
        { error: "Invalid data format" },
        { status: 400 }
      );
    }

    // Delete related records first
    const { error: activitiesError } = await supabase
      .from("people_activities")
      .delete()
      .in('child_id', childIds);

    if (activitiesError) {
      return NextResponse.json({ error: activitiesError.message }, { status: 500 });
    }

    // Delete related subscriptions
    const { error: subscriptionsError } = await supabase
      .from("subscriptions")
      .delete()
      .in('child_id', childIds);

    if (subscriptionsError) {
      return NextResponse.json({ error: subscriptionsError.message }, { status: 500 });
    }

    // Delete related transactions
    const { error: transactionsError } = await supabase
      .from("transaction_ledger")
      .delete()
      .in('child_id', childIds);

    if (transactionsError) {
      return NextResponse.json({ error: transactionsError.message }, { status: 500 });
    }

    // Delete related images
    const { error: imagesError } = await supabase
      .from("sponsor_people_images")
      .delete()
      .in('sponsor_people_id', childIds);

    if (imagesError) {
      return NextResponse.json({ error: imagesError.message }, { status: 500 });
    }

    // Finally delete the children records
    const { error } = await supabase
      .from("sponsor_people")
      .delete()
      .in('id', childIds);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error processing bulk delete:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
} 