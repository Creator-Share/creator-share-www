import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { notifyChildCreated } from "@/services/telegram"
import { calculateAge } from "@/utils/ageCalculator"

export async function POST(req: Request) {
  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response
  
  try {
    const { beneficiaryId } = await req.json()
    
    if (!beneficiaryId) {
      return NextResponse.json({ error: "beneficiaryId is required" }, { status: 400 })
    }

    // Fetch the beneficiary data
    const { data: beneficiary, error } = await supabase
      .from("beneficiaries")
      .select("*")
      .eq("id", beneficiaryId)
      .single()

    if (error || !beneficiary) {
      return NextResponse.json({ error: "Beneficiary not found" }, { status: 404 })
    }

    // Send Telegram notification for child beneficiaries
    if (beneficiary.beneficiary_type === "CHILD") {
      try {
        // Calculate age from birth_date using existing utility
        const age = beneficiary.birth_date ? calculateAge(beneficiary.birth_date) : null;

        const notificationData = {
          ...beneficiary,
          age
        };

        // Send notification
        await notifyChildCreated(notificationData);
      } catch (notificationError) {
        console.error('Telegram notification failed for child:', beneficiary.id, notificationError);
        return NextResponse.json({ error: "Notification failed" }, { status: 500 })
      }
    }

    return NextResponse.json({ message: "Notification sent successfully" }, { status: 200 })
  } catch (error) {
    console.error("Error in notification endpoint:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
} 