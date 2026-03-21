import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export async function GET() {
  const supabase = await createClient()

  try {
    // Children in need = listable as "in need" (New, Partially Funded, Sponsorship Cancelled)
    // and not yet receiving support. Excludes Draft/Archived.
    const { count: childrenInNeed, error: inNeedError } = await supabase
      .from("beneficiaries")
      .select("*", { count: "exact", head: true })
      .eq("beneficiary_type", "CHILD")
      .in("status", ["New", "Partially Funded", "Sponsorship Cancelled"])
      .or("active_subscriptions.eq.0,active_subscriptions.is.null")

    if (inNeedError) {
      console.error("Error fetching children in need count:", inNeedError)
      return NextResponse.json(
        { error: "Failed to fetch children in need count" },
        { status: 500 },
      )
    }

    // Children Sponsored = same set as homepage sponsored strip (Budget Fulfilled children)
    const { count: childrenSupported, error: supportedError } = await supabase
      .from("beneficiaries")
      .select("*", { count: "exact", head: true })
      .eq("beneficiary_type", "CHILD")
      .eq("status", "Budget Fulfilled")

    if (supportedError) {
      console.error("Error fetching supported children count:", supportedError)
      return NextResponse.json(
        { error: "Failed to fetch supported children count" },
        { status: 500 },
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
      { status: 500 },
    )
  }
}
