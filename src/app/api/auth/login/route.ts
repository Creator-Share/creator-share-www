import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  const body = await request.json()
  const { email, password } = body

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 }
    )
  }

  try {
    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      })

    if (signInError) {
      return NextResponse.json(
        { error: signInError.message || "Invalid credentials." },
        { status: 401 }
      )
    }

    const userId = signInData.user?.id

    if (!userId) {
      return NextResponse.json(
        { error: "User ID not found after login." },
        { status: 500 }
      )
    }
    // Verify user has role assignments
    await supabase
      .from("role_assignments")
      .select(
        `
        roles:roles!role_assignments_role_id_fkey(name)
      `
      )
      .eq("user_id", userId)

    return NextResponse.json(
      { message: "Login successful.", redirect: "/" },
      { status: 200 }
    )
  } catch (error) {
    console.error("Error logging in:", error)
    return NextResponse.json(
      { error: "Failed to login." },
      { status: 500 }
    )
  }
}