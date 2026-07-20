import "server-only"

import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

type ResponseCookie = {
  name: string
  value: string
  options?: CookieOptions
}

export function createAdvocateInvitationRouteClient(
  request: NextRequest,
  secureCookies: boolean,
): {
  client: ReturnType<typeof createServerClient>
  applyCookies: (response: NextResponse) => NextResponse
} | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return null

  const pendingCookies: ResponseCookie[] = []
  const client = createServerClient(supabaseUrl, supabaseAnonKey, {
    auth: { flowType: "implicit" },
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: ResponseCookie[]) {
        pendingCookies.push(...cookiesToSet)
      },
    },
  })

  return Object.freeze({
    client,
    applyCookies(response: NextResponse): NextResponse {
      for (const { name, value, options } of pendingCookies) {
        response.cookies.set(name, value, {
          ...options,
          secure: secureCookies,
        })
      }
      return response
    },
  })
}
