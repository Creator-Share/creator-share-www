import { coerceRegion, getStripeClient } from "@/lib/stripe/config"
import { createLegacyStripeSuccessHandler } from "@/lib/payments/legacyProviderCompatibility"
import { createClient } from "@/utils/supabase/server"

export const GET = createLegacyStripeSuccessHandler({
  async getAuthenticatedUser() {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) return null
    return {
      id: data.user.id,
      email: data.user.email,
      emailConfirmedAt: data.user.email_confirmed_at,
    }
  },
  async retrieveSession(sessionId, region) {
    const stripe = getStripeClient(coerceRegion(region))
    return stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["customer"],
    })
  },
})
