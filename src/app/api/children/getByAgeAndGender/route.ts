import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { calculateAge } from "@/utils/ageCalculator";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(req.url);

  const gender = searchParams.get("gender");
  const age = searchParams.get("age");

  try {
    let query = supabase.from("people").select("*");

    if (gender) {
      query = query.eq("gender", gender);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    let filteredData = data || [];

    if (age) {
      filteredData = filteredData.filter((child) => {
        const childAge = calculateAge(new Date(child.birth_date).toISOString());
        if (age === "less_than_1") {
          return childAge < 1;
        }
        return childAge === parseInt(age, 10);
      });
    }

    return NextResponse.json({ people: filteredData });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
