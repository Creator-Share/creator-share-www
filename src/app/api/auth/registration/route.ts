import { NextResponse } from "next/server"

import {
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
  createAdvocateAttributionIdentityCookieValue,
  getAdvocateAttributionIdentityCookieOptions,
} from "@/lib/advocates/attributionIdentityCookie"
import { createClient } from "@/utils/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  const body = await request.json()
  const { email, password, first_name, last_name } = body

  if (!email || !password || !first_name || !last_name) {
    return NextResponse.json(
      { error: "Email, password, first name, and last name are required" },
      { status: 400 },
    )
  }

  try {
    const { data: existingUser } = await supabase
      .from("users")
      .select("email")
      .eq("email", email)
      .single()

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 400 },
      )
    }

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp(
      {
        email,
        password,
        options: {
          data: {
            first_name,
            last_name,
          },
          emailRedirectTo: `http://localhost:3000/app/main/onboarding`,
        },
      },
    )

    if (signUpError) {
      return NextResponse.json({ error: signUpError.message }, { status: 400 })
    }

    if (signUpData.user?.identities?.length === 0) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 400 },
      )
    }

    const response = NextResponse.json(
      {
        message:
          "Registration successful! Please check your email for confirmation.",
      },
      { status: 201 },
    )
    if (signUpData.session && signUpData.user?.id) {
      const identitySignal = createAdvocateAttributionIdentityCookieValue({
        authUserId: signUpData.user.id,
      })
      if (identitySignal) {
        response.cookies.set(
          ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
          identitySignal,
          getAdvocateAttributionIdentityCookieOptions(
            request.headers.get("host"),
            new URL(request.url).protocol === "https:",
          ),
        )
      }
    }
    return response
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Unexpected error occurred"
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
