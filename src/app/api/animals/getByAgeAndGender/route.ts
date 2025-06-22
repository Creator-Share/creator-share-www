import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { calculateAge } from "@/utils/ageCalculator";
import { Beneficiaries, Gender, Status } from "@/types/admin.types";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(req.url);

  const gender = searchParams.get("gender") as Gender | null;
  const statusString = searchParams.get("status") || "";
  const status = statusString.split(",") as Status[];

  try {
    let query = supabase.from("beneficiaries").select("*").eq("beneficiary_type", "ANIMAL");

    if (gender) {
      query = query.eq("gender", gender);
    }

    if (status.length > 0) {
      console.log('Status filter:', status);
      query = query.in("status", status);
    }

    const { data, error } = await query;
    console.log('Query result:', data);
    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    let filteredData: Beneficiaries[] = data as Beneficiaries[] || [];

    const ageRange = searchParams.get("ageRange");
    if (ageRange) {
      const parts = ageRange.split(",").map(Number);
      if (parts.length === 1) {
        const singleAge = parts[0];
        filteredData = filteredData.filter((animal) => {
          if (!animal.birth_date) return false;
          const animalAge = calculateAge(new Date(animal.birth_date).toISOString());
          return animalAge === singleAge;
        });
      } else if (parts.length === 2) {
        const [minAge, maxAge] = parts;
        filteredData = filteredData.filter((animal) => {
          if (!animal.birth_date) return false;
          const animalAge = calculateAge(new Date(animal.birth_date).toISOString());
          return animalAge >= minAge && animalAge <= maxAge;
        });
      }
    }

    return NextResponse.json({ beneficiary: filteredData });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
