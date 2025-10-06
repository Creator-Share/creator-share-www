import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { calculateAge } from "@/utils/ageCalculator"
import { Beneficiaries, Gender, Status } from "@/types/admin.types"

export async function GET(req: Request) {
  const supabase = await createClient()
  
  // Clean up expired reservations
  try {
    await supabase
      .from("beneficiary_reservations")
      .delete()
      .lt("expires_at", new Date().toISOString())
  } catch (error) {
    console.error("Failed to cleanup expired reservations:", error)
  }
  
  const { searchParams } = new URL(req.url)

  const gender = searchParams.get("gender") as Gender | null
  const statusString = searchParams.get("status") || ""
const status = statusString ? statusString.split(",") as Status[] : []
  const beneficiaryType = searchParams.get("beneficiary_type") || "CHILD"

  try {
    let query = supabase
      .from("beneficiaries")
      .select("*")
      .eq("beneficiary_type", beneficiaryType)

    if (gender) {
      query = query.eq("gender", gender)
    }

    if (status.length > 0) {
      query = query.in("status", status)
    }

    const { data, error } = await query
    if (error) {
      console.error("Supabase error:", error)
      return NextResponse.json({ error: "Database error" }, { status: 500 })
    }

    let filteredData: Beneficiaries[] = (data as Beneficiaries[]) || []

    const ageRange = searchParams.get("ageRange")
    if (ageRange) {
      const parts = ageRange.split(",").map(Number)
      if (parts.length === 1) {
        const singleAge = parts[0]
        filteredData = filteredData.filter((b) => {
          if (!b.birth_date) return false
          const age = calculateAge(new Date(b.birth_date).toISOString())
          return age === singleAge
        })
      } else if (parts.length === 2) {
        const [minAge, maxAge] = parts
        filteredData = filteredData.filter((b) => {
          if (!b.birth_date) return false
          const age = calculateAge(new Date(b.birth_date).toISOString())
          return age >= minAge && age <= maxAge
        })
      }
    }

    return NextResponse.json({ people: filteredData })
  } catch (err) {
    console.error("Unexpected error:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
