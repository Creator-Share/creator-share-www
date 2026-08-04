import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export async function GET() {
  try {
    const supabase = await createClient()

    const { data: people, error } = await supabase
      .from("public_beneficiaries")
      .select("*")
      .eq("beneficiary_type", "ANIMAL")

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ people })
  } catch (error) {
    console.error("Error in GET /api/animals/get:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
