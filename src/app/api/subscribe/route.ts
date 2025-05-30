import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const { email, beneficiary } = await req.json();
    if (!email || !beneficiary) {
      return NextResponse.json({ error: "Missing email or beneficiary" }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: beneficiaryData, error: beneficiaryError } = await supabase
      .from("beneficiaries")
      .select("id")
      .eq("name", beneficiary)
      .single();

    if (beneficiaryError || !beneficiaryData) {
      return NextResponse.json({ error: "Beneficiary not found" }, { status: 404 });
    }

    const { error: insertError } = await supabase
      .from("beneficiary_subscriptions")
      .insert({
        beneficiary_id: beneficiaryData.id,
        email,
        created_at: new Date().toISOString(),
      });

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json({ error: "You are already subscribed." }, { status: 409 });
      }
      return NextResponse.json({ error: "Failed to subscribe" }, { status: 500 });
    }

    try {
      const { sendSubscriptionConfirmationEmail } = await import("@/utils/email");
      const emailResult = await sendSubscriptionConfirmationEmail(email, beneficiary);
      await supabase.from("email_logs").insert({
        email,
        subject: `You're subscribed to updates for ${beneficiary}`,
        status: emailResult.success ? "sent" : "failed",
        error: emailResult.error ? JSON.stringify(emailResult.error) : null,
        message_id: emailResult.messageId,
        created_at: new Date(),
      });
    } catch (emailErr) {
      console.error("Error sending subscription confirmation email:", emailErr);
      await supabase.from("email_logs").insert({
        email,
        subject: `You're subscribed to updates for ${beneficiary}`,
        status: "failed",
        error: emailErr instanceof Error ? emailErr.message : String(emailErr),
        created_at: new Date(),
      });
    }

    return NextResponse.json({ message: "Subscribed successfully" });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
