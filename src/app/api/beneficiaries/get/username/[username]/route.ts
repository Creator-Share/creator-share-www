import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { Beneficiaries } from "@/types/admin.types"

export async function GET(req: Request) {
  const supabase = await createClient()
  const url = new URL(req.url)
  const paths = url.pathname.split("/")
  const username = decodeURIComponent(paths[paths.length - 1])

  try {
    const { data, error } = await supabase
      .from("beneficiaries")
      .select("*")
      .eq("username", username)
      .single()

    if (error || !data) {
      return NextResponse.json(
        { error: "Beneficiary not found" },
        { status: 404 },
      )
    }

    return NextResponse.json({ child: data as Beneficiaries })
  } catch (err) {
    console.error("Unexpected error:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
