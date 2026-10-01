import type { Metadata } from "next"

import ClaimAccountClient from "./ClaimAccountClient"

export const metadata: Metadata = {
  title: "Secure your sponsorship account | Creator Share",
  description:
    "Use a secure email link to claim and manage your Creator Share sponsorships.",
  referrer: "no-referrer",
  robots: {
    index: false,
    follow: false,
  },
}

export default function SponsorClaimPage() {
  return <ClaimAccountClient />
}
