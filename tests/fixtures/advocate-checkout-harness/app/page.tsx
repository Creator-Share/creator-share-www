"use client"

import BeneficiaryModal from "@/app/sponsorships/components/SponsorshipModal"
import type { Beneficiaries } from "@/types"

const CHECKOUT_HARNESS_BENEFICIARY_ID = "11111111-1111-4111-8111-111111111111"

const BENEFICIARY: Beneficiaries = {
  id: CHECKOUT_HARNESS_BENEFICIARY_ID,
  name: "Amina Example",
  username: "amina-example",
  gender: "Girl",
  age: 10,
  birth_date: "2016-04-15",
  biography: "A deterministic checkout browser fixture.",
  budget_goal: -1,
  budget_raised: 0,
  status: "New",
  country: "Tanzania",
  location_geo: null,
  location_str: "Arusha",
  video_url: "",
  introduction: "Meet Amina.",
  active_subscriptions: 0,
  metadata: {
    birth_date_is_estimate: false,
    birth_date_precision: "day",
  },
  beneficiary_type: "SPECIAL_NEEDS",
}

export default function AdvocateCheckoutHarness() {
  return (
    <main data-testid="advocate-checkout-harness">
      <BeneficiaryModal
        open
        onClose={() => undefined}
        beneficiary={BENEFICIARY}
      />
    </main>
  )
}
