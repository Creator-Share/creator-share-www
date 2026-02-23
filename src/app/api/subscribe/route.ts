import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  try {
    const { email, beneficiary } = await req.json()
    if (!email || !beneficiary) {
      return NextResponse.json(
        { error: "Missing email or beneficiary" },
        { status: 400 },
      )
    }

    const supabase = await createClient()

    const { data: beneficiaryData, error: beneficiaryError } = await supabase
      .from("beneficiaries")
      .select("id")
      .eq("name", beneficiary)
      .single()

    if (beneficiaryError || !beneficiaryData) {
      return NextResponse.json(
        { error: "Beneficiary not found" },
        { status: 404 },
      )
    }

    const { error: insertError } = await supabase
      .from("activity_subscriptions")
      .insert({
        beneficiary_id: beneficiaryData.id,
        email,
        created_at: new Date().toISOString(),
      })

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json(
          { error: "You are already subscribed." },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { error: "Failed to subscribe" },
        { status: 500 },
      )
    }

    try {
      const { sendSubscriptionConfirmationEmail } = await import(
        "@/utils/email"
      )
      await sendSubscriptionConfirmationEmail(
        email,
        beneficiary,
        null,
        beneficiaryData.id,
      )
    } catch (emailErr) {
      console.error("Error sending subscription confirmation email:", emailErr)
    }

    return NextResponse.json({ message: "Subscribed successfully" })
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
