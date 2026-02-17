import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

export async function GET(req: Request) {
  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response
  const { searchParams } = new URL(req.url)
  const beneficiary_type = searchParams.get("beneficiary_type")

  let query = supabase.from("beneficiaries").select("*")

  if (beneficiary_type) {
    query = query.eq("beneficiary_type", beneficiary_type)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ beneficiaries: data })
}
