import { createBrowserClient } from "@supabase/ssr"
import { assertAdvocateStagingSupabaseBoundary } from "@/lib/advocates/stagingDeploymentBoundary"
import { supabaseAuthCookiesMustBeSecure } from "@/utils/supabase/authCookieSecurity"

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
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        secure: supabaseAuthCookiesMustBeSecure({
          environment: browserEnvironment,
        }),
      },
    },
  )
}
