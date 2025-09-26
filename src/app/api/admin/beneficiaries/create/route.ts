import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { Beneficiaries } from "@/types/admin.types"

export async function POST(req: Request) {
  const supabase = await createClient()
  try {
    const data: Partial<Beneficiaries> = await req.json()

    const insertData = { ...data, status: "New" }
    if (!insertData.country) insertData.country = "Unknown Country"
    if (!insertData.location_str) insertData.location_str = "Unknown Location"
    const { data: inserted, error } = await supabase
      .from("beneficiaries")
      .insert([insertData])
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ beneficiary: inserted }, { status: 201 })
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
