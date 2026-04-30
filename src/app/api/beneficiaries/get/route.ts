import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { Status, Gender } from "@/types/admin.types"
import { Beneficiaries } from "@/types"

type Cursor = { ca: string | null; id: string }

// Strict shapes — both values are interpolated into PostgREST .or() filters,
// so anything that could include `,`, `(`, `)`, or operator-like fragments
// (e.g. `.gt.`) must be rejected to prevent filter injection.
const ISO_RE  = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf-8").toString("base64url")
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf-8")
    const obj = JSON.parse(json)
    if (typeof obj?.id !== "string" || !UUID_RE.test(obj.id)) return null
    if (obj.ca !== null) {
      if (typeof obj.ca !== "string" || !ISO_RE.test(obj.ca)) return null
    }
    return { ca: obj.ca, id: obj.id }
  } catch {
    return null
  }
}

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

  const cursor = cursorParam ? decodeCursor(cursorParam) : null

  try {

    // count=exact only on the first page — on cursor pages the count would
    // reflect rows AFTER the cursor, not the total.
    let query = cursor
      ? supabase.from("beneficiaries").select("*")
      : supabase.from("beneficiaries").select("*", { count: "exact" });

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
      // Include open sponsorships (budget_goal = -1) alongside "waiting-like" filters
      // (New / Partially Funded / Sponsorship Cancelled), since they're perpetual
      // targets. Omit them when the filter is purely terminal (e.g. Budget Fulfilled
      // only) — there, opens would masquerade as "Sponsored", which they aren't.
      // Draft/Archived are admin-controlled visibility states and always excluded
      // from the open branch.
      const statusList = status.map(s => `"${s}"`).join(",")
      const shouldIncludeOpen = status.some((s) => s !== "Budget Fulfilled")
      if (shouldIncludeOpen) {
        const openCondition = 'and(budget_goal.eq.-1,status.not.in.(Draft,Archived))'
        query = query.or(`status.in.(${statusList}),${openCondition}`)
      } else {
        query = query.in("status", status)
      }
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

    // Cursor (keyset) filter — apply BEFORE order/limit.
    // Order is created_at DESC NULLS LAST, id DESC, so "after the cursor" means:
    //   created_at < cursor.ca
    //   OR (created_at = cursor.ca AND id < cursor.id)
    //   OR created_at IS NULL  (NULLs LAST, all come after non-null rows)
    // If the cursor itself is on a NULL-created_at row, only NULL rows with id < cursor.id remain.
    if (cursor) {
      if (cursor.ca !== null) {
        query = query.or(
          `created_at.lt.${cursor.ca},and(created_at.eq.${cursor.ca},id.lt.${cursor.id}),created_at.is.null`
        )
      } else {
        query = query.is("created_at", null).lt("id", cursor.id)
      }
    }

    // Stable ordering: created_at DESC (nulls last), then id DESC.
    // Fetch limit+1 so we can detect "more available" without a follow-up
    // empty request when the total is an exact multiple of `limit`.
    query = query
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(limit + 1)

    const { data, error, count } = await query
    if (error) {
      console.error("Supabase error:", error)
      return NextResponse.json({ error: "Database error" }, { status: 500 })
    }

    const fetched = (data || []) as Beneficiaries[]
    const hasMore = fetched.length > limit
    const rows = hasMore ? fetched.slice(0, limit) : fetched
    const last = hasMore ? rows[rows.length - 1] : null
    const nextCursor =
      last && last.id
        ? encodeCursor({ ca: last.created_at ?? null, id: last.id })
        : null

    return NextResponse.json({
      people: rows,
      totalCount: count ?? null,
      pageInfo: {
        limit,
        nextCursor,
        hasMore,
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
