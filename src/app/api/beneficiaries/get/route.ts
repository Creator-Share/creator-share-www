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
  const adminMode = searchParams.get("admin_mode")

  // Debug logging to understand the issue
  console.log("[API Debug] Received parameters:", {
    beneficiaryType,
    gender,
    statusString,
    status,
    ageRangeParam,
    searchQuery,
    adminMode,
    fullUrl: req.url
  })

  // Pagination params
  const limitParam = Number(searchParams.get("limit") || "9")
  const cursorParam = searchParams.get("cursor")

  // Defensive bounds
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 60)
    : 9

  console.log("[API Debug] Pagination params:", { limitParam, limit, cursorParam, mode: "offset-based" })

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

    // STEP 1: Start with base query
    let query = supabase.from("beneficiaries").select("*");

    if (beneficiaryType) {
      query = query.eq("beneficiary_type", beneficiaryType)
    }
    if (gender) {
      query = query.eq("gender", gender)
      console.log("[API Debug] Applying gender filter:", gender)
    }
    if (status.length > 0) {
      query = query.in("status", status)
      console.log("[API Debug] Applying status filter:", status)
    }

    if (ageRangeParam) {
      console.log("[API Debug] Age range param received:", ageRangeParam)
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
        console.log("[API Debug] Applying age filter - Min DOB:", minDob, "Max DOB:", maxDob)
        query = query.or(`birth_date.is.null,and(birth_date.gte.${minDob},birth_date.lte.${maxDob})`)
      }
    } else {
      console.log("[API Debug] No age range filter applied")
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
    console.log(`[Offset Pagination] Using range: ${rangeStart} to ${rangeEnd} (offset: ${offset}, limit: ${limit})`)

    const { data, error } = await query
    if (error) {
      console.error("Supabase error:", error)
      return NextResponse.json({ error: "Database error" }, { status: 500 })
    }

    // Log returned IDs to detect duplicates
    const returnedIds = (data || []).map((b: Beneficiaries) => b.id)
    console.log(
      `[Offset Pagination] Returned ${returnedIds.length} items (offset: ${offset}, limit: ${limit}):`,
      returnedIds.slice(0, 3),
      "..."
    )
    
    

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
