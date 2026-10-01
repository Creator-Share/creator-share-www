"use client"

import { PublicSiteProvider } from "@/components/advocates/PublicSiteProvider"
import type { AdvocatePublicSite } from "@/lib/advocates/publicSite"

import { BrandedSurface } from "./BrandedSurface"

/**
 * A real advocate-branded document.
 *
 * Existing coverage asserted the branded surface by reading component source
 * text, which cannot catch a component that stops rendering what it imports.
 * This fixture renders the production PublicSiteProvider with an advocate site
 * so the branding can be asserted in the DOM.
 */
const ADVOCATE_SITE: AdvocatePublicSite = {
  kind: "advocate",
  slug: "hope-partners",
  canonicalHostname: "hope-partners.creatorshare.com",
  displayName: "Hope Partners",
  beneficiaryMode: "all_featured",
  primaryColor: "#2b7ff9",
  accentColor: "#f59e0b",
  logoUrl: "https://cdn.example.test/hope-partners/logo.png",
  logoAltText: "Hope Partners logo",
  openingHeaderHtml: "<p>Welcome from <strong>Hope Partners</strong></p>",
  aboutBiographyHtml: "<p>We have supported children since 2019.</p>",
  publicMetrics: [],
}

export default function AdvocatePublicSiteHarness() {
  return (
    <PublicSiteProvider site={ADVOCATE_SITE}>
      <BrandedSurface />
    </PublicSiteProvider>
  )
}
