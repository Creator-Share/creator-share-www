import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export async function POST(req: Request) {
  try {
    const { beneficiaryId } = await req.json()
    
    if (!beneficiaryId) {
      return NextResponse.json(
        { error: "beneficiaryId is required" },
        { status: 400 }
      )
    }

    const supabase = await createClient()
    
    // Delete any incomplete subscriptions for this beneficiary
    const { error } = await supabase
      .from("subscriptions")
      .delete()
      .eq("beneficiary_id", beneficiaryId)
      .eq("status", "incomplete")
    
    if (error) {
      console.error("Error cleaning up incomplete subscription:", error)
      return NextResponse.json(
        { error: "Failed to cleanup subscription" },
        { status: 500 }
      )
    }

    console.log("Successfully cleaned up incomplete subscription for beneficiary:", beneficiaryId)
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Cleanup endpoint error:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
