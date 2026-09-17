import { NextRequest, NextResponse } from "next/server"
import {
  createClient,
  createServiceRoleClient,
} from "@/utils/supabase/server"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  try {
    const { email, beneficiary, beneficiaryId } = await req.json()
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : ""

    if (
      !normalizedEmail ||
      normalizedEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      (!beneficiaryId && !beneficiary)
    ) {
      return NextResponse.json(
        { error: "A valid email and beneficiary are required" },
        { status: 400 },
      )
    }

    const supabase = await createClient()

    let beneficiaryQuery = supabase
      .from("public_beneficiaries")
      .select("id, name")

    beneficiaryQuery = beneficiaryId
      ? beneficiaryQuery.eq("id", beneficiaryId)
      : beneficiaryQuery.eq("name", beneficiary)

    const { data: beneficiaryMatches, error: beneficiaryError } =
      await beneficiaryQuery.limit(2)

    if (
      beneficiaryError ||
      !beneficiaryMatches ||
      beneficiaryMatches.length !== 1
    ) {
      return NextResponse.json(
        { error: "Beneficiary not found" },
        { status: 404 },
      )
    }

    const beneficiaryData = beneficiaryMatches[0]
    const serviceSupabase = createServiceRoleClient()
    const { data: inserted, error: insertError } = await serviceSupabase.rpc(
      "subscribe_to_beneficiary_updates",
      {
        target_beneficiary_id: beneficiaryData.id,
        target_email: normalizedEmail,
        request_id: req.headers.get("x-request-id"),
      },
    )

    if (insertError) {
      return NextResponse.json(
        { error: "Failed to subscribe" },
        { status: 500 },
      )
    }

    if (!inserted) {
      return NextResponse.json(
        { error: "You are already subscribed." },
        { status: 409 },
      )
    }

    try {
      const { sendSubscriptionConfirmationEmail } = await import(
        "@/utils/email"
      )
      await sendSubscriptionConfirmationEmail(
        normalizedEmail,
        beneficiaryData.name,
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
