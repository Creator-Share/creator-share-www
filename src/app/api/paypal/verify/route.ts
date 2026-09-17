import { createLegacyPayPalVerifyHandler } from "@/lib/payments/legacyProviderCompatibility"
import { createClient } from "@/utils/supabase/server"

interface LegacyPayPalSubscriptionPresentation {
  subscription_status: string
  amount_usd_cents: number
  recurrence_interval: string
  charged_amount_minor: number | null
  charged_currency: string | null
  beneficiary_name: string | null
  beneficiary_location: string | null
}

export const GET = createLegacyPayPalVerifyHandler({
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
  async loadOwnedSubscription({ subscriptionId }) {
    const supabase = await createClient()
    const { data, error } = await supabase
      .rpc("get_my_legacy_paypal_subscription_presentation", {
        target_provider_subscription_id: subscriptionId,
      })
      .maybeSingle()
    if (error || !data) return null
    const presentation = data as LegacyPayPalSubscriptionPresentation
    return {
      status: presentation.subscription_status,
      amount: presentation.amount_usd_cents,
      interval: presentation.recurrence_interval,
      charged_amount: presentation.charged_amount_minor,
      charged_currency: presentation.charged_currency,
      beneficiaries: presentation.beneficiary_name
        ? {
            name: presentation.beneficiary_name,
            location_str: presentation.beneficiary_location ?? "",
          }
        : null,
    }
  },
})
