import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export async function GET() {
  const supabase = await createClient()

  try {
    // Children in need = on platform, not draft/archived, and not yet receiving support
    const { count: childrenInNeed, error: inNeedError } = await supabase
      .from("beneficiaries")
      .select("*", { count: "exact", head: true })
      .eq("beneficiary_type", "CHILD")
      .not("status", "in", '("Draft","Archived")')
      .or("active_subscriptions.eq.0,active_subscriptions.is.null")

    if (inNeedError) {
      console.error("Error fetching children in need count:", inNeedError)
      return NextResponse.json(
        { error: "Failed to fetch children in need count" },
        { status: 500 }
      )
    }

    // Children supported = at least one active subscription (excluding Draft/Archived)
    // (excluding Draft and Archived, same as above)
    const { count: childrenSupported, error: supportedError } = await supabase
      .from("beneficiaries")
      .select("*", { count: "exact", head: true })
      .eq("beneficiary_type", "CHILD")
      .not("status", "in", '("Draft","Archived")')
      .gt("active_subscriptions", 0)

    if (supportedError) {
      console.error("Error fetching supported children count:", supportedError)
      return NextResponse.json(
        { error: "Failed to fetch supported children count" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      childrenInNeed: childrenInNeed || 0,
      childrenSupported: childrenSupported || 0,
    })
  } catch (err) {
    console.error("Unexpected error fetching stats:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
