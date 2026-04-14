import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { ACTIVE_STATUSES } from "@/config/beneficiaryStatuses"

export async function GET(req: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)
  const beneficiaryTypeParam = searchParams.get("beneficiary_type")

  try {
    // Waiting count: matches the same OR condition used by the main beneficiary listing.
    // Includes any type unless a specific type is requested (e.g. for type-filtered views).
    // Does NOT filter by active_subscriptions — Partially Funded beneficiaries are still
    // waiting and should be counted. Does NOT filter by type unless explicitly requested.
    const statusList = ACTIVE_STATUSES.map((s) => `"${s}"`).join(",")
    const openCondition = "and(budget_goal.eq.-1,status.not.in.(Draft,Archived))"

    let waitingQuery = supabase
      .from("beneficiaries")
      .select("*", { count: "exact", head: true })
      .or(`status.in.(${statusList}),${openCondition}`)

    if (beneficiaryTypeParam) {
      const types = beneficiaryTypeParam
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
      if (types.length === 1) {
        waitingQuery = waitingQuery.eq("beneficiary_type", types[0])
      } else if (types.length > 1) {
        waitingQuery = waitingQuery.in("beneficiary_type", types)
      }
    }

    const { count: childrenInNeed, error: inNeedError } = await waitingQuery

    if (inNeedError) {
      console.error("Error fetching waiting count:", inNeedError)
      return NextResponse.json(
        { error: "Failed to fetch waiting count" },
        { status: 500 },
      )
    }

    // Sponsored count: Budget Fulfilled beneficiaries (same set as the sponsored row).
    // Filtered by type when requested so the stats card reflects the active tab.
    let sponsoredQuery = supabase
      .from("beneficiaries")
      .select("*", { count: "exact", head: true })
      .eq("status", "Budget Fulfilled")

    if (beneficiaryTypeParam) {
      const types = beneficiaryTypeParam
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
      if (types.length === 1) {
        sponsoredQuery = sponsoredQuery.eq("beneficiary_type", types[0])
      } else if (types.length > 1) {
        sponsoredQuery = sponsoredQuery.in("beneficiary_type", types)
      }
    }

    const { count: childrenSupported, error: supportedError } = await sponsoredQuery

    if (supportedError) {
      console.error("Error fetching sponsored count:", supportedError)
      return NextResponse.json(
        { error: "Failed to fetch sponsored count" },
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
