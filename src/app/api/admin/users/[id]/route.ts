import { createClient } from "@/utils/supabase/server"
import { requireSuperAdminRequest } from "@/utils/auth/requireSuperAdminRequest"
import { offboardAccounts } from "@/utils/admin/offboardAccounts"

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient({ requestTimeoutMilliseconds: 15_000 })
  const auth = await requireSuperAdminRequest(supabase, request)
  if (!auth.ok) return auth.response
  return offboardAccounts(supabase, [(await params).id])
}
