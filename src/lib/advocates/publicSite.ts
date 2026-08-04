export const CREATOR_SHARE_PRIMARY_COLOR = "#1C3C8C"
export const CREATOR_SHARE_ACCENT_COLOR = "#F4B942"

export type PublicSiteBeneficiaryMode = "all" | "all_featured" | "selected"

export type PublicSiteMetricKey =
  | "children_sponsored"
  | "gross_raised_usd"
  | "direct_sponsorships"
  | "post_visit_attributed_sponsorships"

export type PublicSiteMetricUnit = "count" | "usd_cents"

export type PublicSiteMetric =
  | Readonly<{
      key: PublicSiteMetricKey
      status: "published"
      value: string
      unit: PublicSiteMetricUnit
      qualifier: "at_least"
      asOf: string
    }>
  | Readonly<{
      key: PublicSiteMetricKey
      status: "pending"
      value: null
      unit: null
      qualifier: null
      asOf: null
    }>

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
  publicMetrics: readonly PublicSiteMetric[]
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

export interface PublicSiteImpactMetricItem {
  key: PublicSiteMetricKey
  label: string
  definition: string
  formattedValue: string
  timing: string
  asOf: string | null
}

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
  publicMetrics: readonly PublicSiteMetric[]
}

const INTEGER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
})

const AS_OF_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
})

const PUBLIC_SITE_METRIC_CONTENT: Readonly<
  Record<PublicSiteMetricKey, Readonly<{ label: string; definition: string }>>
> = Object.freeze({
  children_sponsored: {
    label: "Children sponsored",
    definition:
      "Distinct children supported by sponsorships attributed to this advocate portal.",
  },
  gross_raised_usd: {
    label: "Gross funds raised",
    definition:
      "Successful sponsorship payments attributed to this advocate portal, before refunds, reversals, and disputes.",
  },
  direct_sponsorships: {
    label: "Direct sponsorships",
    definition: "Sponsorships completed while visiting this advocate portal.",
  },
  post_visit_attributed_sponsorships: {
    label: "Post-visit sponsorships",
    definition:
      "Sponsorships completed on Creator Share within 30 days after visiting this advocate portal.",
  },
})

export function formatPublicSiteMetricValue(metric: PublicSiteMetric): string {
  if (metric.status === "pending") return "Not available yet"

  const quantity = BigInt(metric.value)
  const formatted =
    metric.unit === "usd_cents"
      ? `$${INTEGER_FORMATTER.format(quantity / 100n)}`
      : INTEGER_FORMATTER.format(quantity)
  return metric.qualifier === "at_least" ? `${formatted}+` : formatted
}

export function formatPublicSiteMetricAsOf(
  metric: PublicSiteMetric,
): string | null {
  return metric.status === "published"
    ? `As of ${AS_OF_DATE_FORMATTER.format(new Date(metric.asOf))}`
    : null
}

export function createPublicSiteImpactMetricItems(
  site: PublicSite,
): readonly PublicSiteImpactMetricItem[] {
  if (site.kind !== "advocate") return Object.freeze([])

  return Object.freeze(
    site.publicMetrics.map((metric) => {
      const content = PUBLIC_SITE_METRIC_CONTENT[metric.key]
      return Object.freeze({
        key: metric.key,
        label: content.label,
        definition: content.definition,
        formattedValue: formatPublicSiteMetricValue(metric),
        timing:
          formatPublicSiteMetricAsOf(metric) ??
          "Updates after the first privacy-safe milestone.",
        asOf: metric.asOf,
      })
    }),
  )
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
    publicMetrics: Object.freeze([]),
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
    publicMetrics: Object.freeze(
      source.publicMetrics.map((metric) => Object.freeze({ ...metric })),
    ),
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
    publicMetrics: Object.freeze([]),
  })
}
