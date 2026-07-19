import "server-only"

import {
  ADVOCATE_LOCALHOST_ROOT,
  ADVOCATE_TENANT_ROOT,
  resolveAdvocateHost,
  type ResolveAdvocateHostOptions,
} from "./host"
import {
  sanitizeAdvocateAboutBiographyRichText,
  sanitizeAdvocateOpeningHeaderRichText,
} from "./richText"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const LOWERCASE_UUID_WEBP_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const HOSTNAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const PUBLIC_METRIC_RELEASE_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T00:00:00Z$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const MAX_LOGO_ALT_TEXT_LENGTH = 300
const MAX_DISPLAY_ORDER = 2_147_483_647

export const PUBLIC_ADVOCATE_LOGO_BUCKET = "advocate-assets"

export const DEFAULT_PRIMARY_HOSTNAMES = Object.freeze([
  ADVOCATE_TENANT_ROOT,
  `www.${ADVOCATE_TENANT_ROOT}`,
] as const)

export const PUBLIC_ADVOCATE_METRIC_KEYS = Object.freeze([
  "children_sponsored",
  "gross_raised_usd",
  "direct_sponsorships",
  "post_visit_attributed_sponsorships",
] as const)

export type PublicAdvocateMetricKey =
  (typeof PUBLIC_ADVOCATE_METRIC_KEYS)[number]

const PUBLIC_METRIC_KEY_SET = new Set<string>(PUBLIC_ADVOCATE_METRIC_KEYS)
const PUBLIC_METRIC_SOURCE_FIELDS = Object.freeze([
  "as_of",
  "display_order",
  "key",
  "qualifier",
  "status",
  "unit",
  "value",
] as const)
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n
const COUNT_PRIVACY_BUCKET = 5n
const USD_CENTS_PRIVACY_BUCKET = 10_000n
const POSITIVE_DECIMAL_PATTERN = /^[1-9][0-9]{0,18}$/

export interface PublicAdvocatePresentationRepository {
  loadByCanonicalHostname(hostname: string): Promise<unknown | null>
}

export interface PublicAdvocateAssetOptions {
  /**
   * Defaults to NEXT_PUBLIC_SUPABASE_URL. Passing null explicitly disables
   * public logo URL generation without making the advocate unavailable.
   */
  logoPublicOrigin?: string | null
  /** Only trusted local development configuration may permit an HTTP origin. */
  allowInsecureLocalLogoOrigin?: boolean
}

export interface ResolvePublicAdvocateRequestOptions
  extends ResolveAdvocateHostOptions, PublicAdvocateAssetOptions {
  /**
   * Extra non-tenant hosts, such as a specific Vercel preview hostname, that
   * a trusted runtime configuration explicitly permits to serve the primary
   * Creator Share experience.
   */
  approvedPrimaryHostnames?: readonly string[]
}

export interface PublicAdvocatePresentation {
  canonicalHostname: string
  slug: string
  displayName: string
  beneficiaryMode: "all" | "all_featured" | "selected"
  primaryColor: string
  accentColor: string
  logoUrl: string | null
  logoAltText: string | null
  openingHeaderHtml: string
  aboutBiographyHtml: string
  publicMetrics: readonly PublicAdvocateMetric[]
}

export type PublicAdvocateMetricUnit = "count" | "usd_cents"

export type PublicAdvocateMetric =
  | Readonly<{
      key: PublicAdvocateMetricKey
      status: "published"
      value: string
      unit: PublicAdvocateMetricUnit
      qualifier: "at_least"
      asOf: string
    }>
  | Readonly<{
      key: PublicAdvocateMetricKey
      status: "pending"
      value: null
      unit: null
      qualifier: null
      asOf: null
    }>

export type PublicAdvocateRequestResolution =
  | {
      kind: "primary"
      hostname: string
    }
  | {
      kind: "active-advocate"
      presentation: PublicAdvocatePresentation
    }
  | {
      kind: "unavailable-tenant"
      canonicalHostname: string
      reason: "not-found-or-inactive" | "invalid-presentation"
    }
  | {
      kind: "operational-failure"
      canonicalHostname: string
      error: unknown
    }
  | {
      kind: "rejected-host"
      reason: string
      hostname: string | null
    }

type MetricSelection = {
  displayOrder: number
  metric: PublicAdvocateMetric
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function strictUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null
}

function boundedTrimmedText(
  value: unknown,
  maximumLength: number,
  allowEmpty: boolean,
): string | null {
  if (
    typeof value !== "string" ||
    value.length > maximumLength ||
    value !== value.trim() ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    (!allowEmpty && value.length === 0)
  ) {
    return null
  }
  return value
}

function readinessTimestamp(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    RFC3339_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

function publicMetricReleaseTimestamp(value: unknown): boolean {
  if (
    typeof value !== "string" ||
    !PUBLIC_METRIC_RELEASE_TIMESTAMP_PATTERN.test(value)
  ) {
    return false
  }

  const parsed = new Date(value)
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.getUTCDay() === 1 &&
    parsed.toISOString() === value.replace("Z", ".000Z")
  )
}

function displayOrder(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_DISPLAY_ORDER
    ? value
    : null
}

function hasExactFields(
  value: Record<string, unknown>,
  expectedFields: readonly string[],
): boolean {
  const actualFields = Object.keys(value).sort()
  return (
    actualFields.length === expectedFields.length &&
    actualFields.every((field, index) => field === expectedFields[index])
  )
}

function metricUnitForKey(
  key: PublicAdvocateMetricKey,
): PublicAdvocateMetricUnit {
  return key === "gross_raised_usd" ? "usd_cents" : "count"
}

function privacyBucketForUnit(unit: PublicAdvocateMetricUnit): bigint {
  return unit === "usd_cents" ? USD_CENTS_PRIVACY_BUCKET : COUNT_PRIVACY_BUCKET
}

function validBucketedValue(value: unknown, unit: PublicAdvocateMetricUnit) {
  if (typeof value !== "string" || !POSITIVE_DECIMAL_PATTERN.test(value)) {
    return false
  }

  const parsed = BigInt(value)
  return (
    parsed <= POSTGRES_BIGINT_MAX && parsed % privacyBucketForUnit(unit) === 0n
  )
}

function parseMetric(
  item: Record<string, unknown>,
  key: PublicAdvocateMetricKey,
): PublicAdvocateMetric | null {
  if (!hasExactFields(item, PUBLIC_METRIC_SOURCE_FIELDS)) return null

  if (item.status === "pending") {
    if (
      item.value !== null ||
      item.unit !== null ||
      item.qualifier !== null ||
      item.as_of !== null
    ) {
      return null
    }

    return Object.freeze({
      key,
      status: "pending",
      value: null,
      unit: null,
      qualifier: null,
      asOf: null,
    })
  }

  const expectedUnit = metricUnitForKey(key)
  if (
    item.status !== "published" ||
    item.unit !== expectedUnit ||
    item.qualifier !== "at_least" ||
    !validBucketedValue(item.value, expectedUnit) ||
    !publicMetricReleaseTimestamp(item.as_of)
  ) {
    return null
  }

  return Object.freeze({
    key,
    status: "published",
    value: item.value as string,
    unit: expectedUnit,
    qualifier: "at_least",
    asOf: item.as_of as string,
  })
}

function exactLogoStoragePath(
  value: unknown,
  advocateSlug: string,
): string | null | undefined {
  if (value === null) return null
  if (typeof value !== "string" || CONTROL_CHARACTER_PATTERN.test(value)) {
    return undefined
  }

  const segments = value.split("/")
  if (
    segments.length !== 3 ||
    segments[0] !== "logos" ||
    segments[1] !== advocateSlug ||
    !LOWERCASE_UUID_WEBP_PATTERN.test(segments[2])
  ) {
    return undefined
  }

  return value
}

function isLocalLogoHostname(hostname: string): boolean {
  return (
    hostname === ADVOCATE_LOCALHOST_ROOT ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  )
}

function configuredLogoPublicOrigin(
  options: PublicAdvocateAssetOptions,
): string | null {
  const configured =
    options.logoPublicOrigin === undefined
      ? process.env.NEXT_PUBLIC_SUPABASE_URL
      : options.logoPublicOrigin
  if (
    typeof configured !== "string" ||
    configured.length === 0 ||
    configured !== configured.trim() ||
    CONTROL_CHARACTER_PATTERN.test(configured)
  ) {
    return null
  }

  try {
    const url = new URL(configured)
    if (
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null
    }

    const secure = url.protocol === "https:"
    const permittedLocalHttp =
      url.protocol === "http:" &&
      options.allowInsecureLocalLogoOrigin === true &&
      isLocalLogoHostname(url.hostname)
    return secure || permittedLocalHttp ? url.origin : null
  } catch {
    return null
  }
}

function safeLogoUrl(
  storagePath: unknown,
  advocateSlug: string,
  options: PublicAdvocateAssetOptions,
): string | null | undefined {
  const exactPath = exactLogoStoragePath(storagePath, advocateSlug)
  if (exactPath === undefined || exactPath === null) return exactPath

  const publicOrigin = configuredLogoPublicOrigin(options)
  if (publicOrigin === null) return null

  const encodedPath = exactPath.split("/").map(encodeURIComponent).join("/")
  return `${publicOrigin}/storage/v1/object/public/${PUBLIC_ADVOCATE_LOGO_BUCKET}/${encodedPath}`
}

function parseMetricSelections(
  value: unknown,
): readonly PublicAdvocateMetric[] | null {
  if (
    !Array.isArray(value) ||
    value.length > PUBLIC_ADVOCATE_METRIC_KEYS.length
  ) {
    return null
  }

  const selections: MetricSelection[] = []
  const seenKeys = new Set<string>()
  const seenOrders = new Set<number>()

  for (const item of value) {
    if (!isRecord(item)) return null

    const key = item.key
    const order = displayOrder(item.display_order)
    if (
      typeof key !== "string" ||
      !PUBLIC_METRIC_KEY_SET.has(key) ||
      order === null ||
      seenKeys.has(key) ||
      seenOrders.has(order)
    ) {
      return null
    }

    const metric = parseMetric(item, key as PublicAdvocateMetricKey)
    if (metric === null) return null

    seenKeys.add(key)
    seenOrders.add(order)
    selections.push({
      displayOrder: order,
      metric,
    })
  }

  selections.sort((left, right) => left.displayOrder - right.displayOrder)
  if (selections.some((selection, index) => selection.displayOrder !== index)) {
    return null
  }

  return Object.freeze(selections.map((selection) => selection.metric))
}

function buildPresentation(
  source: unknown,
  canonicalHostname: string,
  options: PublicAdvocateAssetOptions,
): PublicAdvocatePresentation | null {
  if (!isRecord(source)) return null

  const domain = source.domain
  const advocate = source.advocate
  const branding = source.branding
  if (!isRecord(domain) || !isRecord(advocate) || !isRecord(branding)) {
    return null
  }

  const advocateId = strictUuid(domain.advocate_id)
  if (
    advocateId === null ||
    domain.hostname !== canonicalHostname ||
    domain.status !== "active" ||
    !readinessTimestamp(domain.dns_verified_at) ||
    !readinessTimestamp(domain.tls_ready_at) ||
    !readinessTimestamp(domain.payments_ready_at) ||
    !readinessTimestamp(domain.activated_at) ||
    advocate.id !== advocateId ||
    advocate.relationship_status !== "active" ||
    advocate.publication_status !== "active" ||
    branding.advocate_id !== advocateId
  ) {
    return null
  }

  const slug = advocate.slug
  const displayName = boundedTrimmedText(advocate.display_name, 160, false)
  const beneficiaryMode = advocate.beneficiary_mode
  const primaryColor = branding.primary_color
  const accentColor = branding.accent_color
  if (
    typeof slug !== "string" ||
    !SLUG_PATTERN.test(slug) ||
    displayName === null ||
    (beneficiaryMode !== "all" &&
      beneficiaryMode !== "all_featured" &&
      beneficiaryMode !== "selected") ||
    typeof primaryColor !== "string" ||
    !COLOR_PATTERN.test(primaryColor) ||
    typeof accentColor !== "string" ||
    !COLOR_PATTERN.test(accentColor)
  ) {
    return null
  }

  const logoUrl = safeLogoUrl(branding.logo_storage_path, slug, options)
  const configuredLogoAltText =
    branding.logo_alt_text === null
      ? null
      : boundedTrimmedText(
          branding.logo_alt_text,
          MAX_LOGO_ALT_TEXT_LENGTH,
          true,
        )
  if (
    logoUrl === undefined ||
    (configuredLogoAltText === null && branding.logo_alt_text !== null)
  ) {
    return null
  }

  const publicMetrics = parseMetricSelections(source.metricSelections)
  if (publicMetrics === null) return null

  let openingHeaderHtml: string
  let aboutBiographyHtml: string
  try {
    openingHeaderHtml = sanitizeAdvocateOpeningHeaderRichText(
      branding.opening_header_html,
    )
    aboutBiographyHtml = sanitizeAdvocateAboutBiographyRichText(
      branding.about_biography_html,
    )
  } catch {
    return null
  }

  return Object.freeze({
    canonicalHostname,
    slug,
    displayName,
    beneficiaryMode,
    primaryColor: primaryColor.toUpperCase(),
    accentColor: accentColor.toUpperCase(),
    logoUrl,
    logoAltText:
      logoUrl === null ? null : configuredLogoAltText || `${displayName} logo`,
    openingHeaderHtml,
    aboutBiographyHtml,
    publicMetrics,
  })
}

function normalizeApprovedPrimaryHostname(value: string): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return null
  }

  const lower = value.toLowerCase()
  const hostname = lower.endsWith(".") ? lower.slice(0, -1) : lower
  return hostname.length <= 253 && HOSTNAME_PATTERN.test(hostname)
    ? hostname
    : null
}

function approvedPrimaryHostnames(
  options: ResolvePublicAdvocateRequestOptions,
): ReadonlySet<string> {
  const approved = new Set<string>(DEFAULT_PRIMARY_HOSTNAMES)
  for (const configured of options.approvedPrimaryHostnames ?? []) {
    const hostname = normalizeApprovedPrimaryHostname(configured)
    if (hostname !== null) approved.add(hostname)
  }
  if (options.allowLocalhostDevelopment) {
    approved.add(ADVOCATE_LOCALHOST_ROOT)
    approved.add("127.0.0.1")
    approved.add("[::1]")
  }
  return approved
}

export async function resolvePublicAdvocateRequest(
  rawHost: string | null | undefined,
  repository: PublicAdvocatePresentationRepository,
  options: ResolvePublicAdvocateRequestOptions = {},
): Promise<PublicAdvocateRequestResolution> {
  const host = resolveAdvocateHost(rawHost, options)

  if (host.kind === "invalid") {
    return {
      kind: "rejected-host",
      reason: host.reason,
      hostname: null,
    }
  }

  if (host.kind === "non-tenant") {
    if (approvedPrimaryHostnames(options).has(host.normalizedHostname)) {
      return {
        kind: "primary",
        hostname: host.normalizedHostname,
      }
    }
    return {
      kind: "rejected-host",
      reason: host.reason,
      hostname: host.normalizedHostname,
    }
  }

  const canonicalHostname = host.domainLookup.hostname
  let source: unknown | null
  try {
    source = await repository.loadByCanonicalHostname(canonicalHostname)
  } catch (error) {
    return {
      kind: "operational-failure",
      canonicalHostname,
      error,
    }
  }

  if (source === null) {
    return {
      kind: "unavailable-tenant",
      canonicalHostname,
      reason: "not-found-or-inactive",
    }
  }

  const presentation = buildPresentation(source, canonicalHostname, options)
  return presentation === null
    ? {
        kind: "unavailable-tenant",
        canonicalHostname,
        reason: "invalid-presentation",
      }
    : { kind: "active-advocate", presentation }
}
