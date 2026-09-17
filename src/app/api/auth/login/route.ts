import { NextResponse } from "next/server"

import {
  advocateAttributionIdentityCookieSetHeaders,
  createAdvocateAttributionIdentityCookieValue,
} from "@/lib/advocates/attributionIdentityCookie"
import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedPrimaryRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import { readBoundedSponsorManagementBody } from "@/lib/sponsorships/management/passwordlessAccess"
import { createClient } from "@/utils/supabase/server"

export async function POST(request: Request) {
  const expectedOrigin = resolveTrustedPrimaryRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    expectedOrigin === null ||
    !isTrustedCheckoutJsonRequest(request.headers, expectedOrigin)
  ) {
    return NextResponse.json({ error: "Invalid login request." }, { status: 400 })
  }

  const serialized = await readBoundedSponsorManagementBody(request, 8192)
  let body: unknown
  try {
    body = serialized === null ? null : JSON.parse(serialized)
  } catch {
    body = null
  }
  const email =
    body && typeof body === "object" ? Reflect.get(body, "email") : null
  const password =
    body && typeof body === "object" ? Reflect.get(body, "password") : null
  if (
    typeof email !== "string" ||
    email.length === 0 ||
    typeof password !== "string" ||
    password.length === 0
  ) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 },
    )
  }

  try {
    const supabase = await createClient()
    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      })

    if (signInError) {
      return NextResponse.json(
        { error: signInError.message || "Invalid credentials." },
        { status: 401 },
      )
    }

    const userId = signInData.user?.id

    if (!userId) {
      return NextResponse.json(
        { error: "User ID not found after login." },
        { status: 500 },
      )
    }
    const response = NextResponse.json(
      { message: "Login successful.", redirect: "/" },
      { status: 200 },
    )
    const identitySignal = createAdvocateAttributionIdentityCookieValue(
      {
        authUserId: userId,
      },
      { rawHost: request.headers.get("host") },
    )
    if (identitySignal) {
      for (const header of advocateAttributionIdentityCookieSetHeaders(
        identitySignal,
        request.headers.get("host"),
        new URL(request.url).protocol === "https:",
      )) {
        response.headers.append("Set-Cookie", header)
      }
    }
    return response
  } catch {
    console.error("Password login failed")
    return NextResponse.json({ error: "Failed to login." }, { status: 500 })
  }
}
