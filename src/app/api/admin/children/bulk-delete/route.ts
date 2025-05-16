import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { beneficiaryIds, childIds } = await request.json();
    const ids = beneficiaryIds || childIds;
    const supabase = await createClient();
    
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "Invalid data format" },
        { status: 400 }
      );
    }

    const { error: activitiesError } = await supabase
      .from("activities")
      .delete()
      .in('beneficiary_id', ids);

    if (activitiesError) {
      return NextResponse.json({ error: activitiesError.message }, { status: 500 });
    }

    const { error: subscriptionsError } = await supabase
      .from("subscriptions")
      .delete()
      .in('beneficiary_id', ids);

    if (subscriptionsError) {
      return NextResponse.json({ error: subscriptionsError.message }, { status: 500 });
    }

    const { error: transactionsError } = await supabase
      .from("transaction_ledger")
      .delete()
      .in('beneficiary_id', ids);

    if (transactionsError) {
      return NextResponse.json({ error: transactionsError.message }, { status: 500 });
    }

    const { error: imagesError } = await supabase
      .from("media")
      .delete()
      .in('beneficiary_id', ids);

    if (imagesError) {
      return NextResponse.json({ error: imagesError.message }, { status: 500 });
    }

    const { error } = await supabase
      .from("beneficiaries")
      .delete()
      .in('id', ids);

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
