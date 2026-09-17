import { createClient } from "@/utils/supabase/server"
import { requireSuperAdminRequest } from "@/utils/auth/requireSuperAdminRequest"
import { deleteBeneficiaries } from "@/utils/admin/deleteBeneficiaries"

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const auth = await requireSuperAdminRequest(supabase, request)
  if (!auth.ok) return auth.response
  return deleteBeneficiaries(supabase, [(await params).id])
}
