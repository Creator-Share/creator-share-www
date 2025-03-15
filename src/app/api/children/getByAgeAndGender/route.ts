import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { calculateAge } from "@/utils/ageCalculator";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(req.url);

  const gender = searchParams.get("gender");
  const status = searchParams.get("status");

  try {
    let query = supabase.from("sponsor_people").select("*");

    if (gender) {
      query = query.eq("gender", gender);
    }

    if (status) {
      const statusArray = status.split(",");
      query = query.in("status", statusArray);
    }

    const { data, error } = await query;
    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    let filteredData = data || [];

    const ageRange = searchParams.get("ageRange");
    if (ageRange) {
      const parts = ageRange.split(",").map(Number);
      if (parts.length === 1) {
        const singleAge = parts[0];
        filteredData = filteredData.filter((child) => {
          const childAge = calculateAge(new Date(child.birth_date).toISOString());
          return childAge === singleAge;
        });
      } else if (parts.length === 2) {
        const [minAge, maxAge] = parts;
        filteredData = filteredData.filter((child) => {
          const childAge = calculateAge(new Date(child.birth_date).toISOString());
          return childAge >= minAge && childAge <= maxAge;
        });
      }
    }
    
    console.log("API response children:", filteredData.length);
    console.log("Age range filter:", ageRange);
    
    const uniqueIds = new Set(filteredData.map(child => child.id));
    console.log("Unique children count:", uniqueIds.size, "Total children:", filteredData.length);
    
    return NextResponse.json({ people: filteredData });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
