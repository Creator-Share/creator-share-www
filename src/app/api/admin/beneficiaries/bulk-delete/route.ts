import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdminRequest } from "@/utils/auth/requireSuperAdminRequest"
import { deleteBeneficiaries } from "@/utils/admin/deleteBeneficiaries"
import { readBoundedSponsorManagementBody } from "@/lib/sponsorships/management/passwordlessAccess"

export async function POST(request: Request) {
  const supabase = await createClient()
  const auth = await requireSuperAdminRequest(supabase, request)
  if (!auth.ok) return auth.response
  let body: unknown
  try {
    const serialized = await readBoundedSponsorManagementBody(request, 32768)
    body = serialized === null ? null : JSON.parse(serialized)
  } catch {
    body = null
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid deletion request" }, { status: 400 })
  }
  return deleteBeneficiaries(supabase, Reflect.get(body, "ids"))
}
