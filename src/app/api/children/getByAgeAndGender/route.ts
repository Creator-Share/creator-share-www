import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { calculateAge } from "@/utils/ageCalculator";
import { ChildSponsorship } from "@/types";

type RawChildSponsorship = ChildSponsorship & { child_details?: Partial<ChildSponsorship> };

export async function GET(req: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(req.url);

  const gender = searchParams.get("gender");
  const status = searchParams.get("status");

  try {
    // Query base sponsorships table with child-specific details
    let query = supabase
      .from("sponsorships")
      .select(`
        *,
        child_details(*)
      `)
      .eq('sponsorship_type', 'CHILD');

    if (gender) {
      query = query.eq("child_details.gender", gender);
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

    // Transform data to match ChildSponsorship interface
    let transformedData = (data || []).map((item: RawChildSponsorship) => ({
      ...item,
      ...item.child_details,
      child_details: undefined
    }));

    const ageRange = searchParams.get("ageRange");
    if (ageRange) {
      const parts = ageRange.split(",").map(Number);
      if (parts.length === 1) {
        const singleAge = parts[0];
        transformedData = transformedData.filter((child) => {
          const childAge = calculateAge(new Date(child.birth_date).toISOString());
          return childAge === singleAge;
        });
      } else if (parts.length === 2) {
        const [minAge, maxAge] = parts;
        transformedData = transformedData.filter((child) => {
          const childAge = calculateAge(new Date(child.birth_date).toISOString());
          return childAge >= minAge && childAge <= maxAge;
        });
      }
    }
    
    console.log("API response children:", transformedData.length);
    console.log("Age range filter:", ageRange);
    
    const uniqueIds = new Set(transformedData.map(child => child.id));
    console.log("Unique children count:", uniqueIds.size, "Total children:", transformedData.length);
    
    return NextResponse.json({ children: transformedData });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
