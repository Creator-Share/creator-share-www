import { NextResponse } from "next/server"
import {
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
  getAdvocateAttributionIdentityCookieOptions,
} from "@/lib/advocates/attributionIdentityCookie"
import { createClient } from "@/utils/supabase/server"

export async function POST(request: Request) {
  const supabase = await createClient()

  try {
    const { error } = await supabase.auth.signOut()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    const response = NextResponse.json(
      { message: "Logout successful" },
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
      err instanceof Error ? err.message : "Unexpected error occurred"
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
