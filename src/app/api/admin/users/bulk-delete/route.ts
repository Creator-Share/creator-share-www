import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdminRequest } from "@/utils/auth/requireSuperAdminRequest"
import { offboardAccounts } from "@/utils/admin/offboardAccounts"
import { readBoundedSponsorManagementBody } from "@/lib/sponsorships/management/passwordlessAccess"

export async function POST(request: Request) {
  const supabase = await createClient({ requestTimeoutMilliseconds: 15_000 })
  const auth = await requireSuperAdminRequest(supabase, request)
  if (!auth.ok) return auth.response
  let body: unknown
  try {
    const raw = await readBoundedSponsorManagementBody(request, 32768)
    body = raw === null ? null : JSON.parse(raw)
  } catch { body = null }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid account selection" }, { status: 400 })
  }
  return offboardAccounts(supabase, Reflect.get(body, "ids"))
}
