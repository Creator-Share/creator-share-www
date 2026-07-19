import "server-only"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Email token hashes must be redeemable in a different browser from the one
 * that requested the message. The ordinary SSR client always enables PKCE and
 * therefore writes a browser-bound verifier cookie. This sender deliberately
 * has no storage and no PKCE state. The custom Supabase email template carries
 * only the one-time token hash to the canonical confirmation interstitial.
 */
export function createStatelessSponsorEmailAuthClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("sponsor_email_auth_unavailable")
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "implicit",
      persistSession: false,
    },
  })
}
