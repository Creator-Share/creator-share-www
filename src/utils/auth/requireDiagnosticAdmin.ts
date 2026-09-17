import "server-only"

import type { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdminRequest } from "@/utils/auth/requireSuperAdminRequest"

/** Diagnostic provider calls require staff authority and a same-origin action. */
export async function requireDiagnosticAdmin(
  request: Request,
): Promise<NextResponse | null> {
  const auth = await requireSuperAdminRequest(await createClient(), request)
  return auth.ok ? null : auth.response
}
