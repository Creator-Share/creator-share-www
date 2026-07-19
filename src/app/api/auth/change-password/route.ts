import { NextResponse } from "next/server"
import {
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
  getAdvocateAttributionIdentityCookieOptions,
} from "@/lib/advocates/attributionIdentityCookie"
import { createClient } from "@/utils/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()
  const body = await request.json()
  const { password } = body

  if (!password) {
    return NextResponse.json(
      { error: "Password is required." },
      { status: 400 },
    )
  }

  try {
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message || "Failed to reset password." },
        { status: 500 },
      )
    }

    const { error: signOutError } = await supabase.auth.signOut()

    if (signOutError) {
      return NextResponse.json(
        {
          error:
            signOutError.message || "Password updated, but failed to log out.",
        },
        { status: 500 },
      )
    }

    const response = NextResponse.json(
      { message: "Password reset successful! User has been logged out." },
      { status: 200 },
    )
    response.cookies.set(ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME, "", {
      ...getAdvocateAttributionIdentityCookieOptions(
        request.headers.get("host"),
        new URL(request.url).protocol === "https:",
      ),
      expires: new Date(0),
      maxAge: 0,
    })
    return response
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Unexpected error occurred."
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
