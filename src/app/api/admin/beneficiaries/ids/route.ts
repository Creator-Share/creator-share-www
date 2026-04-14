import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { Status, Gender } from "@/types/admin.types"
import { INACTIVE_STATUSES } from "@/config/beneficiaryStatuses"

export async function GET(req: Request) {
  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)

  const beneficiaryType = searchParams.get("beneficiary_type")
  const gender = searchParams.get("gender") as Gender | null
  const statusString = searchParams.get("status") || ""
  const status = statusString ? (statusString.split(",") as Status[]) : []
  const ageRangeParam = searchParams.get("ageRange")
  const searchQuery = searchParams.get("search")

  try {
    let query = supabase.from("beneficiaries").select("id")

    if (beneficiaryType && beneficiaryType !== "null" && beneficiaryType !== "undefined") {
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
      query = query.in("status", status)
    }

    const isAnimalType = (beneficiaryType ?? "").split(",").includes("ANIMAL")
    const shouldSkipAgeRange =
      isAnimalType ||
      (status || []).some((s) => (INACTIVE_STATUSES as string[]).includes(s))

    if (ageRangeParam && !shouldSkipAgeRange) {
      const parts = ageRangeParam.split(",").map((v) => Number(v.trim()))
      if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
        const [minAgeInYears, maxAgeInYears] =
          parts[0] <= parts[1] ? parts : [parts[1], parts[0]]

        const now = new Date()
        const dateYearsAgo = (years: number) =>
          new Date(now.getFullYear() - years, now.getMonth(), now.getDate())

        const minDob = dateYearsAgo(maxAgeInYears + 1).toISOString()
        const maxDob = dateYearsAgo(minAgeInYears).toISOString()
        query = query.or(`birth_date.is.null,and(birth_date.gte.${minDob},birth_date.lte.${maxDob})`)
      }
    }

    if (searchQuery) {
      query = query.or(`name.ilike.%${searchQuery}%,username.ilike.%${searchQuery}%`)
    }

    const { data, error } = await query

    if (error) {
      console.error("Beneficiary IDs fetch error:", error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    const ids = (data ?? []).map((row: { id: string }) => row.id).filter(Boolean)
    return NextResponse.json({ ids })
  } catch (error) {
    console.error("Beneficiary IDs route error:", error)
    return NextResponse.json({ error: "Failed to fetch beneficiary IDs" }, { status: 500 })
  }
}
