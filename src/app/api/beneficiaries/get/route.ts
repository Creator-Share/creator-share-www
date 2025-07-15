import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { Beneficiaries, Status, Gender } from "@/types/admin.types";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(req.url);

  const beneficiaryType = searchParams.get("beneficiary_type");
  const gender = searchParams.get("gender") as Gender | null;
  const statusString = searchParams.get("status") || "";
  const status = statusString ? statusString.split(",") as Status[] : [];

  try {
    let query = supabase.from("beneficiaries").select("*");

    if (beneficiaryType) {
      query = query.eq("beneficiary_type", beneficiaryType);
    }
    if (gender) {
      query = query.eq("gender", gender);
    }
    if (status.length > 0) {
      query = query.in("status", status);
    }

    const { data, error } = await query;
    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    return NextResponse.json({ people: data as Beneficiaries[] });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
