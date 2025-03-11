import { NextResponse } from "next/server";
import { sendPaymentFailedEmail } from "@/utils/email";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email') || 'your-email@example.com';
    
    const result = await sendPaymentFailedEmail(
      email,
      'Test Child',
      25.99,
      new Date(Date.now() + 24 * 60 * 60 * 1000)
    );
    
    return NextResponse.json({ 
      success: true, 
      message: "Test email sent",
      result
    });
  } catch (error) {
    console.error("Error sending test email:", error);
    return NextResponse.json({ error: "Failed to send test email" }, { status: 500 });
  }
} 