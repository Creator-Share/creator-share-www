import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

export async function POST(req: Request) {
  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response
  try {
    const { ids, status } = await req.json()
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "No IDs provided" }, { status: 400 })
    }

    if (!status || typeof status !== 'string') {
      return NextResponse.json({ error: "Status is required" }, { status: 400 })
    }

    // Validate status values (SOC - separation of concerns)
    const validStatuses = ['New', 'Partially Funded', 'Budget Fulfilled', 'Archived', 'Draft']
    
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }

    // Single responsibility - just update status (remove updated_at)
    const { error: updateError } = await supabase
      .from("beneficiaries")
      .update({ 
        status
      })
      .in("id", ids)

    if (updateError) {
      console.error('Supabase update error:', updateError)
      return NextResponse.json(
        { error: updateError.message },
        { status: 400 },
      )
    }
    return NextResponse.json({ 
      message: `Successfully updated ${ids.length} beneficiaries to ${status}` 
    })
  } catch (error) {
    console.error("Bulk status update error:", error)
    return NextResponse.json(
      { error: "Failed to update beneficiary status" },
      { status: 500 },
    )
  }
} 