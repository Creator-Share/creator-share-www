import { createBrowserClient, serializeCookieHeader, type CookieOptions } from "@supabase/ssr"
import { assertAdvocateStagingSupabaseBoundary } from "@/lib/advocates/stagingDeploymentBoundary"
import { supabaseAuthCookieConfiguration, parseSupabaseAuthCookies } from "@/utils/supabase/authCookieSecurity"

export function createClient() {
  const browserEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }
  assertAdvocateStagingSupabaseBoundary(browserEnvironment, {
    requireServiceRole: false,
  })
  const cookieOptions = supabaseAuthCookieConfiguration(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    { environment: browserEnvironment },
  )
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions,
      cookies: {
        getAll: () => parseSupabaseAuthCookies(
          typeof document === "undefined" ? null : document.cookie,
          cookieOptions.name,
        ),
        setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
          for (const { name, value, options } of cookiesToSet) {
            document.cookie = serializeCookieHeader(name, value, options)
          }
        },
      },
    },
  )
}
