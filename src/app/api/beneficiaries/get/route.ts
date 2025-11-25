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

  // Decode cursor (created_at|id) if provided
  let cursorCreatedAt: string | null = null
  let cursorId: string | null = null
  if (cursorParam) {
    try {
      const decoded = Buffer.from(cursorParam, "base64").toString("utf-8")
      const [ts, id] = decoded.split("|")
      if (ts && id) {
        cursorCreatedAt = ts
        cursorId = id
      }
    } catch {
      // ignore invalid cursor
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
    }
    if (status.length > 0) {
      query = query.in("status", status)
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

    // Keyset (cursor) pagination: created_at DESC, id DESC
    if (cursorCreatedAt && cursorId) {
      // Records strictly older than the cursor in the composite order
      query = query.or(
        `created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`
      )
      console.log(
        `[Cursor Pagination] Using cursor: ${cursorCreatedAt}|${cursorId}`
      )
    }

    // Stable ordering: sort_weight DESC (higher weight first), then created_at DESC, then id DESC
    query = query
      .order("sort_weight", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit)

    const { data, error } = await query
    if (error) {
      console.error("Supabase error:", error)
      return NextResponse.json({ error: "Database error" }, { status: 500 })
    }

    // Log returned IDs to detect duplicates
    const returnedIds = (data || []).map((b: Beneficiaries) => b.id)
    console.log(
      `[Cursor Pagination] Returned ${returnedIds.length} items:`,
      returnedIds.slice(0, 3),
      "..."
    )

    // Check for duplicates in this response
    const uniqueIds = new Set(returnedIds)
    if (uniqueIds.size !== returnedIds.length) {
      console.error(
        `[Cursor Pagination] ⚠️  DUPLICATE IDs IN RESPONSE! Total: ${returnedIds.length}, Unique: ${uniqueIds.size}`
      )
    }

    const lastItem = data && data.length > 0 ? data[data.length - 1] : null

    return NextResponse.json({
      people: (data || []) as Beneficiaries[],
      pageInfo: {
        limit,
        nextCursor:
          data && data.length === limit && lastItem
            ? Buffer.from(`${lastItem.created_at}|${lastItem.id}`).toString(
                "base64"
              )
            : null,
        hasMore: Boolean(data && data.length === limit),
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
