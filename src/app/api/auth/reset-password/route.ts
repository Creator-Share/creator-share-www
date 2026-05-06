import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  const body = await request.json()
  const { email } = body

  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 })
  }

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email)

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to send code." },
        { status: 500 },
      )
    }

    return NextResponse.json(
      { message: "Code sent to your email." },
      { status: 200 },
    )
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Unexpected error occurred."
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
