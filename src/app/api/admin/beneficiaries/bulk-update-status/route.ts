import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export async function POST(req: Request) {
  const supabase = await createClient()
  try {
    const { ids, status } = await req.json()
    
    console.log('Received request:', { ids, status, statusType: typeof status })
    
    if (!Array.isArray(ids) || ids.length === 0) {
      console.log('No IDs provided')
      return NextResponse.json({ error: "No IDs provided" }, { status: 400 })
    }

    if (!status || typeof status !== 'string') {
      console.log('Status validation failed:', { status, statusType: typeof status })
      return NextResponse.json({ error: "Status is required" }, { status: 400 })
    }

    // Validate status values (SOC - separation of concerns)
    const validStatuses = ['New', 'Partially Funded', 'Budget Fulfilled', 'Archived', 'Draft']
    console.log('Checking status:', status, 'against valid statuses:', validStatuses)
    
    if (!validStatuses.includes(status)) {
      console.log('Invalid status:', status)
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }

    console.log('Status validation passed, updating beneficiaries...')

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

    console.log('Update successful')
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