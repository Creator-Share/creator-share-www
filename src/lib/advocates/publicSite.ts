export const CREATOR_SHARE_PRIMARY_COLOR = "#1C3C8C"
export const CREATOR_SHARE_ACCENT_COLOR = "#F4B942"

export type PublicSiteBeneficiaryMode = "all" | "all_featured" | "selected"

export type PublicSiteMetricKey =
  | "children_sponsored"
  | "active_sponsorships"
  | "verified_sponsor_accounts"
  | "unique_sponsor_contacts"
  | "gross_raised_usd"
  | "net_raised_usd"
  | "direct_sponsorships"
  | "post_visit_attributed_sponsorships"
  | "post_visit_observed_sponsorships"

interface PublicSiteBase {
  canonicalHostname: string
  displayName: string
  beneficiaryMode: PublicSiteBeneficiaryMode
  primaryColor: string
  accentColor: string
  logoUrl: string | null
  logoAltText: string | null
  openingHeaderHtml: string
  aboutBiographyHtml: string
  publicMetricKeys: readonly PublicSiteMetricKey[]
}

export interface PrimaryPublicSite extends PublicSiteBase {
  kind: "primary"
  slug: null
}

export interface AdvocatePublicSite extends PublicSiteBase {
  kind: "advocate"
  slug: string
}

export interface PaymentPublicSite extends PublicSiteBase {
  kind: "payment"
  slug: null
}

/**
 * This is the only tenant presentation object that crosses the server to
 * client boundary. It contains no tenant IDs, memberships, sponsor data,
 * provider metadata, raw storage paths, or database errors.
 */
export type PublicSite =
  PrimaryPublicSite | AdvocatePublicSite | PaymentPublicSite

export interface PublicAdvocateSiteSource {
  canonicalHostname: string
  slug: string
  displayName: string
  beneficiaryMode: PublicSiteBeneficiaryMode
  primaryColor: string
  accentColor: string
  logoUrl: string | null
  logoAltText: string | null
  openingHeaderHtml: string
  aboutBiographyHtml: string
  publicMetricKeys: readonly PublicSiteMetricKey[]
}

export function createPrimaryPublicSite(
  canonicalHostname: string,
): PrimaryPublicSite {
  return Object.freeze({
    kind: "primary",
    canonicalHostname,
    slug: null,
    displayName: "Creator Share",
    beneficiaryMode: "all",
    primaryColor: CREATOR_SHARE_PRIMARY_COLOR,
    accentColor: CREATOR_SHARE_ACCENT_COLOR,
    logoUrl: null,
    logoAltText: null,
    openingHeaderHtml: "",
    aboutBiographyHtml: "",
    publicMetricKeys: Object.freeze([]),
  })
}

export function createAdvocatePublicSite(
  source: PublicAdvocateSiteSource,
): AdvocatePublicSite {
  return Object.freeze({
    kind: "advocate",
    canonicalHostname: source.canonicalHostname,
    slug: source.slug,
    displayName: source.displayName,
    beneficiaryMode: source.beneficiaryMode,
    primaryColor: source.primaryColor,
    accentColor: source.accentColor,
    logoUrl: source.logoUrl,
    logoAltText: source.logoAltText,
    openingHeaderHtml: source.openingHeaderHtml,
    aboutBiographyHtml: source.aboutBiographyHtml,
    publicMetricKeys: Object.freeze([...source.publicMetricKeys]),
  })
}

export function createPaymentPublicSite(): PaymentPublicSite {
  return Object.freeze({
    kind: "payment",
    canonicalHostname: "creatorshare.com",
    slug: null,
    displayName: "Creator Share",
    beneficiaryMode: "all",
    primaryColor: CREATOR_SHARE_PRIMARY_COLOR,
    accentColor: CREATOR_SHARE_ACCENT_COLOR,
    logoUrl: null,
    logoAltText: null,
    openingHeaderHtml: "",
    aboutBiographyHtml: "",
    publicMetricKeys: Object.freeze([]),
  })
}
