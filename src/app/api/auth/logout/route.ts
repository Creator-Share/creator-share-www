import { NextResponse } from "next/server"
import { advocateAttributionIdentityCookieClearHeaders } from "@/lib/advocates/attributionIdentityCookie"
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
    for (const header of advocateAttributionIdentityCookieClearHeaders(
      request.headers.get("host"),
      new URL(request.url).protocol === "https:",
    )) {
      response.headers.append("Set-Cookie", header)
    }
    return response
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Unexpected error occurred"
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
