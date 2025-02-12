import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: fetchedData, error } = await supabase.from("sponsor_people").select("*");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const formattedData = fetchedData.map((child) => ({
      ...child,
      budget_goal: (child.budget_goal / 100).toFixed(2),
    }));

    return NextResponse.json(formattedData);
  } catch (error) {
    console.error("Error retrieving children:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
