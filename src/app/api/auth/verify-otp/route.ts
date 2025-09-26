import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  const body = await request.json()
  const { email, token, type } = body

  if (!email || !token || !type) {
    return NextResponse.json(
      { error: "Email, token, and type are required." },
      { status: 400 },
    )
  }

  try {
    const { error } = await supabase.auth.verifyOtp({ email, token, type })

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to verify OTP." },
        { status: 400 },
      )
    }

    return NextResponse.json(
      { message: "OTP verified successfully." },
      { status: 200 },
    )
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Unexpected error occurred."
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
