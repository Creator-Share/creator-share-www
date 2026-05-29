import { NextResponse } from "next/server"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"
import { filterExistingMediaRows, MediaRow } from "@/utils/supabase/media"

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
      .eq("parent_id", id)
      .order("weight")

    if (error) {
      console.error("Supabase error:", error)
      return NextResponse.json({ error: "Database error" }, { status: 500 })
    }

    const serviceSupabase = createServiceRoleClient()
    const existing = await filterExistingMediaRows(serviceSupabase, (data || []) as unknown as MediaRow[])

    return NextResponse.json(existing)
  } catch (err) {
    console.error("Unexpected error:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
