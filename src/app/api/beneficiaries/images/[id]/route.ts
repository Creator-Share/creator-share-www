import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { id } = await params

  try {
    const { data, error } = await supabase
      .from("media")
      .select("*")
      .eq("beneficiary_id", id)
      .order("order_index")

    if (error) {
      console.error("Supabase error:", error)
      return NextResponse.json({ error: "Database error" }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error("Unexpected error:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
