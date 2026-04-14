import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { Status, Gender } from "@/types/admin.types"
import { Beneficiaries } from "@/types"

export async function GET(req: Request) {
  const supabase = await createClient()

  const { searchParams } = new URL(req.url)

  const beneficiaryType = searchParams.get("beneficiary_type")
  const gender = searchParams.get("gender") as Gender | null
  const statusString = searchParams.get("status") || ""
  const status = statusString ? (statusString.split(",") as Status[]) : []
  const ageRangeParam = searchParams.get("ageRange")
  const searchQuery = searchParams.get("search")


  // Pagination params
  const limitParam = Number(searchParams.get("limit") || "9")
  const cursorParam = searchParams.get("cursor")

  // Defensive bounds
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 60)
    : 9

  // TEMPORARY: Use offset-based pagination instead of cursor-based
  // This is a workaround for the cursor pagination issues we were experiencing
  // TODO: Switch back to cursor-based pagination after fixing the .or() filter conflicts
  let offset = 0
  if (cursorParam) {
    try {
      const decoded = Buffer.from(cursorParam, "base64").toString("utf-8")
      offset = Number(decoded)
      if (!Number.isFinite(offset) || offset < 0) {
        offset = 0
      }
    } catch {
      offset = 0
    }
  }

  try {

    // STEP 1: Start with base query — count=exact adds Prefer: count=exact header
    // so PostgREST returns a Content-Range total alongside the page data (no extra round trip).
    let query = supabase.from("beneficiaries").select("*", { count: "exact" });

    if (beneficiaryType && beneficiaryType !== "null" && beneficiaryType !== "undefined") {
      // Support comma-separated types (e.g. "CHILD,CHILD_LABORER")
      const types = beneficiaryType.split(",").map((t) => t.trim()).filter(Boolean)
      if (types.length === 1) {
        query = query.eq("beneficiary_type", types[0])
      } else if (types.length > 1) {
        query = query.in("beneficiary_type", types)
      }
    }
    if (gender) {
      query = query.eq("gender", gender)
    }
    if (status.length > 0) {
      // Include open sponsorships (budget_goal = -1) regardless of status filter,
      // except Draft/Archived which are admin-controlled visibility states.
      const statusList = status.map(s => `"${s}"`).join(",")
      const openCondition = 'and(budget_goal.eq.-1,status.not.in.(Draft,Archived))'
      query = query.or(`status.in.(${statusList}),${openCondition}`)
    }

    if (ageRangeParam) {
      const parts = ageRangeParam.split(",").map((v) => Number(v.trim()))
      if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
        const [minAgeInYears, maxAgeInYears] =
          parts[0] <= parts[1] ? parts : [parts[1], parts[0]]

        const now = new Date()
        const dateYearsAgo = (years: number) =>
          new Date(now.getFullYear() - years, now.getMonth(), now.getDate())

        // People between min and max age inclusive → born between (now - (max+1) years) and (now - min years)
        // Also include those with null birth_date
        const minDob = dateYearsAgo(maxAgeInYears + 1).toISOString()
        const maxDob = dateYearsAgo(minAgeInYears).toISOString()
        query = query.or(`birth_date.is.null,and(birth_date.gte.${minDob},birth_date.lte.${maxDob})`)
      }
    }

    // Search by name or username
    if (searchQuery && searchQuery.trim()) {
      const searchTerm = searchQuery.trim()
      query = query.or(
        `name.ilike.%${searchTerm}%,username.ilike.%${searchTerm}%`
      )
    }

    // Stable ordering: created_at DESC (nulls last), then id DESC
    query = query
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
    
    // TEMPORARY: Use offset-based pagination - always use .range() for consistency
    const rangeStart = offset
    const rangeEnd = offset + limit - 1
    query = query.range(rangeStart, rangeEnd)

    const { data, error, count } = await query
    if (error) {
      console.error("Supabase error:", error)
      return NextResponse.json({ error: "Database error" }, { status: 500 })
    }

    // Log returned IDs to detect duplicates
    const returnedIds = (data || []).map((b: Beneficiaries) => b.id)
    
    // Check for duplicates in this response
    const uniqueIds = new Set(returnedIds)
    if (uniqueIds.size !== returnedIds.length) {
      console.error(
        `[Offset Pagination] ⚠️  DUPLICATE IDs IN RESPONSE! Total: ${returnedIds.length}, Unique: ${uniqueIds.size}`
      )
    }

    const hasMoreData = Boolean(data && data.length === limit)
    
    

    return NextResponse.json({
      people: (data || []) as Beneficiaries[],
      totalCount: count ?? null,
      pageInfo: {
        limit,
        nextCursor:
          data && data.length === limit
            ? Buffer.from(String(offset + limit)).toString("base64")
            : null,
        hasMore: hasMoreData,
      },
    })
  } catch (err) {
    console.error("Unexpected error:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
