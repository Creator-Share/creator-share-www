import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

const UTC_MIDNIGHT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0{1,6})?(?:Z|\+00:00)$/

export const ADVOCATE_ANALYTICS_SEGMENT_KEYS = Object.freeze([
  "direct",
  "post_visit_0_1_day",
  "post_visit_1_7_days",
  "post_visit_7_30_days",
  "observed_30_365_days",
] as const)

export const ADVOCATE_ANALYTICS_CURRENCIES = Object.freeze([
  "AUD",
  "EUR",
  "GBP",
  "USD",
] as const)

export type AdvocateAnalyticsSegmentKey =
  (typeof ADVOCATE_ANALYTICS_SEGMENT_KEYS)[number]
export type AdvocateAnalyticsCurrency =
  (typeof ADVOCATE_ANALYTICS_CURRENCIES)[number]

export interface SuppressedAdvocateAnalyticsCell {
  suppressed: true
}

export interface VisibleAdvocateAnalyticsCell {
  suppressed: false
  sponsorships: number
  uniqueSponsorContacts: number
  verifiedSponsorAccounts: number | null
  initialCollectedUsdCents: number
  renewalCollectedUsdCents: number | null
  grossCollectedUsdCents: number | null
  refundsAndReversalsUsdCents: number | null
  disputeDebitsUsdCents: number | null
  disputeCreditsUsdCents: number | null
  netCollectedUsdCents: number | null
  activeMonthlyCommitmentUsdCents: number | null
  activeAnnualCommitmentUsdCents: number | null
  annualizedCommitmentUsdCents: number | null
}

export type AdvocateAnalyticsCell =
  SuppressedAdvocateAnalyticsCell | VisibleAdvocateAnalyticsCell

export interface AdvocateAnalyticsSegment extends VisibleAdvocateAnalyticsCell {
  key: AdvocateAnalyticsSegmentKey
}

export interface AdvocateAnalyticsOriginalCurrency {
  suppressed: false
  currency: AdvocateAnalyticsCurrency
  sponsorships: number
  uniqueSponsorContacts: number
  initialCollectedMinor: number
  renewalCollectedMinor: number | null
  grossCollectedMinor: number | null
  refundsAndReversalsMinor: number | null
  disputeDebitsMinor: number | null
  disputeCreditsMinor: number | null
  netCollectedMinor: number | null
}

export interface AdvocateAnalyticsSnapshot {
  schemaVersion: 1
  asOf: string
  methodology: {
    minimumSponsorContactsPerCell: 5
    officialWindowDays: 30
    observedWindowDays: 365
    renewalsIncreaseFundsNotCounts: true
    measureSuppressionEnabled: true
  }
  official: AdvocateAnalyticsCell
  observed: AdvocateAnalyticsCell
  segments: readonly AdvocateAnalyticsSegment[] | null
  originalCurrency: readonly AdvocateAnalyticsOriginalCurrency[] | null
}

const SEGMENT_NULLABLE_FIELDS = Object.freeze([
  "verifiedSponsorAccounts",
  "renewalCollectedUsdCents",
  "grossCollectedUsdCents",
  "refundsAndReversalsUsdCents",
  "disputeDebitsUsdCents",
  "disputeCreditsUsdCents",
  "netCollectedUsdCents",
  "activeMonthlyCommitmentUsdCents",
  "activeAnnualCommitmentUsdCents",
  "annualizedCommitmentUsdCents",
] satisfies readonly (keyof AdvocateAnalyticsSegment)[])

const CURRENCY_NULLABLE_FIELDS = Object.freeze([
  "renewalCollectedMinor",
  "grossCollectedMinor",
  "refundsAndReversalsMinor",
  "disputeDebitsMinor",
  "disputeCreditsMinor",
  "netCollectedMinor",
] satisfies readonly (keyof AdvocateAnalyticsOriginalCurrency)[])

export interface AdvocateAnalyticsRepository {
  load(advocateId: string): Promise<AdvocateAnalyticsSnapshot>
}

type SupabaseErrorLike = Readonly<{ code?: string }> | null

export class AdvocateAnalyticsRepositoryError extends Error {
  readonly stage: "query" | "shape"

  constructor(stage: "query" | "shape", cause: SupabaseErrorLike = null) {
    super("advocate_analytics_unavailable", { cause })
    this.name = "AdvocateAnalyticsRepositoryError"
    this.stage = stage
  }
}

const SNAPSHOT_KEYS = Object.freeze([
  "as_of",
  "methodology",
  "observed",
  "official",
  "original_currency",
  "schema_version",
  "segments",
] as const)
const METHODOLOGY_KEYS = Object.freeze([
  "measure_suppression_enabled",
  "minimum_sponsor_contacts_per_cell",
  "observed_window_days",
  "official_window_days",
  "renewals_increase_funds_not_counts",
] as const)
const VISIBLE_CELL_KEYS = Object.freeze([
  "active_annual_commitment_usd_cents",
  "active_monthly_commitment_usd_cents",
  "annualized_commitment_usd_cents",
  "dispute_credits_usd_cents",
  "dispute_debits_usd_cents",
  "gross_collected_usd_cents",
  "initial_collected_usd_cents",
  "net_collected_usd_cents",
  "refunds_and_reversals_usd_cents",
  "renewal_collected_usd_cents",
  "sponsorships",
  "suppressed",
  "unique_sponsor_contacts",
  "verified_sponsor_accounts",
] as const)
const ORIGINAL_CURRENCY_KEYS = Object.freeze([
  "currency",
  "dispute_credits_minor",
  "dispute_debits_minor",
  "gross_collected_minor",
  "initial_collected_minor",
  "net_collected_minor",
  "refunds_and_reversals_minor",
  "renewal_collected_minor",
  "sponsorships",
  "suppressed",
  "unique_sponsor_contacts",
] as const)

const SEGMENT_KEY_SET = new Set<string>(ADVOCATE_ANALYTICS_SEGMENT_KEYS)
const CURRENCY_SET = new Set<string>(ADVOCATE_ANALYTICS_CURRENCIES)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  )
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isNullableSafeNonnegativeInteger(
  value: unknown,
): value is number | null {
  return value === null || isSafeNonnegativeInteger(value)
}

function hasConsistentNullMasks<T>(
  values: readonly T[],
  keys: readonly (keyof T)[],
): boolean {
  if (values.length < 2) return true

  return keys.every((key) => {
    const firstIsNull = values[0]?.[key] === null
    return values.every((value) => (value[key] === null) === firstIsNull)
  })
}

function parseCell(value: unknown): AdvocateAnalyticsCell | null {
  if (!isRecord(value) || typeof value.suppressed !== "boolean") return null
  if (value.suppressed) {
    return hasExactKeys(value, ["suppressed"])
      ? Object.freeze({ suppressed: true })
      : null
  }
  if (!hasExactKeys(value, VISIBLE_CELL_KEYS)) return null

  const sponsorships = value.sponsorships
  const uniqueSponsorContacts = value.unique_sponsor_contacts
  const verifiedSponsorAccounts = value.verified_sponsor_accounts
  const initialCollectedUsdCents = value.initial_collected_usd_cents
  const renewalCollectedUsdCents = value.renewal_collected_usd_cents
  const grossCollectedUsdCents = value.gross_collected_usd_cents
  const refundsAndReversalsUsdCents = value.refunds_and_reversals_usd_cents
  const disputeDebitsUsdCents = value.dispute_debits_usd_cents
  const disputeCreditsUsdCents = value.dispute_credits_usd_cents
  const netCollectedUsdCents = value.net_collected_usd_cents
  const activeMonthlyCommitmentUsdCents =
    value.active_monthly_commitment_usd_cents
  const activeAnnualCommitmentUsdCents =
    value.active_annual_commitment_usd_cents
  const annualizedCommitmentUsdCents = value.annualized_commitment_usd_cents
  const netDependenciesWithheld =
    renewalCollectedUsdCents === null ||
    refundsAndReversalsUsdCents === null ||
    disputeDebitsUsdCents === null ||
    disputeCreditsUsdCents === null

  if (
    !isSafeNonnegativeInteger(sponsorships) ||
    !isSafeNonnegativeInteger(uniqueSponsorContacts) ||
    !isNullableSafeNonnegativeInteger(verifiedSponsorAccounts) ||
    !isSafeNonnegativeInteger(initialCollectedUsdCents) ||
    !isNullableSafeNonnegativeInteger(renewalCollectedUsdCents) ||
    !isNullableSafeNonnegativeInteger(grossCollectedUsdCents) ||
    !isNullableSafeNonnegativeInteger(refundsAndReversalsUsdCents) ||
    !isNullableSafeNonnegativeInteger(disputeDebitsUsdCents) ||
    !isNullableSafeNonnegativeInteger(disputeCreditsUsdCents) ||
    !isNullableSafeNonnegativeInteger(netCollectedUsdCents) ||
    !isNullableSafeNonnegativeInteger(activeMonthlyCommitmentUsdCents) ||
    !isNullableSafeNonnegativeInteger(activeAnnualCommitmentUsdCents) ||
    !isNullableSafeNonnegativeInteger(annualizedCommitmentUsdCents) ||
    uniqueSponsorContacts > sponsorships ||
    (verifiedSponsorAccounts !== null &&
      verifiedSponsorAccounts > uniqueSponsorContacts) ||
    (verifiedSponsorAccounts !== null &&
      verifiedSponsorAccounts > 0 &&
      verifiedSponsorAccounts < 5) ||
    (verifiedSponsorAccounts !== null &&
      uniqueSponsorContacts - verifiedSponsorAccounts > 0 &&
      uniqueSponsorContacts - verifiedSponsorAccounts < 5) ||
    (uniqueSponsorContacts > 0 && uniqueSponsorContacts < 5) ||
    (grossCollectedUsdCents === null) !== (renewalCollectedUsdCents === null) ||
    (netCollectedUsdCents === null) !== netDependenciesWithheld ||
    (renewalCollectedUsdCents !== null &&
      grossCollectedUsdCents !== null &&
      initialCollectedUsdCents + renewalCollectedUsdCents !==
        grossCollectedUsdCents) ||
    (grossCollectedUsdCents !== null &&
      refundsAndReversalsUsdCents !== null &&
      disputeDebitsUsdCents !== null &&
      disputeCreditsUsdCents !== null &&
      netCollectedUsdCents !== null &&
      grossCollectedUsdCents -
        refundsAndReversalsUsdCents -
        disputeDebitsUsdCents +
        disputeCreditsUsdCents !==
        netCollectedUsdCents) ||
    (activeMonthlyCommitmentUsdCents !== null &&
      activeAnnualCommitmentUsdCents !== null &&
      annualizedCommitmentUsdCents !== null &&
      activeMonthlyCommitmentUsdCents * 12 + activeAnnualCommitmentUsdCents !==
        annualizedCommitmentUsdCents) ||
    (annualizedCommitmentUsdCents !== null &&
      (activeMonthlyCommitmentUsdCents === null ||
        activeAnnualCommitmentUsdCents === null))
  ) {
    return null
  }

  return Object.freeze({
    suppressed: false,
    sponsorships,
    uniqueSponsorContacts,
    verifiedSponsorAccounts,
    initialCollectedUsdCents,
    renewalCollectedUsdCents,
    grossCollectedUsdCents,
    refundsAndReversalsUsdCents,
    disputeDebitsUsdCents,
    disputeCreditsUsdCents,
    netCollectedUsdCents,
    activeMonthlyCommitmentUsdCents,
    activeAnnualCommitmentUsdCents,
    annualizedCommitmentUsdCents,
  })
}

function parseSegments(
  value: unknown,
): readonly AdvocateAnalyticsSegment[] | null | undefined {
  if (value === null) return null
  if (
    !Array.isArray(value) ||
    value.length !== ADVOCATE_ANALYTICS_SEGMENT_KEYS.length
  ) {
    return undefined
  }

  const segments: AdvocateAnalyticsSegment[] = []
  for (const [index, item] of value.entries()) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ["key", ...VISIBLE_CELL_KEYS]) ||
      typeof item.key !== "string" ||
      item.key !== ADVOCATE_ANALYTICS_SEGMENT_KEYS[index] ||
      !SEGMENT_KEY_SET.has(item.key)
    ) {
      return undefined
    }
    const cellSource = { ...item }
    delete cellSource.key
    const cell = parseCell(cellSource)
    if (cell === null || cell.suppressed) return undefined
    segments.push(
      Object.freeze({
        key: item.key as AdvocateAnalyticsSegmentKey,
        ...cell,
      }),
    )
  }
  if (!hasConsistentNullMasks(segments, SEGMENT_NULLABLE_FIELDS)) {
    return undefined
  }
  return Object.freeze(segments)
}

function parseOriginalCurrency(
  value: unknown,
): readonly AdvocateAnalyticsOriginalCurrency[] | null | undefined {
  if (value === null) return null
  if (!Array.isArray(value) || value.length > CURRENCY_SET.size) {
    return undefined
  }

  const currencies: AdvocateAnalyticsOriginalCurrency[] = []
  let previousCurrency: string | null = null
  for (const item of value) {
    if (!isRecord(item) || !hasExactKeys(item, ORIGINAL_CURRENCY_KEYS)) {
      return undefined
    }
    const currency = item.currency
    const suppressed = item.suppressed
    const sponsorships = item.sponsorships
    const uniqueSponsorContacts = item.unique_sponsor_contacts
    const initialCollectedMinor = item.initial_collected_minor
    const renewalCollectedMinor = item.renewal_collected_minor
    const grossCollectedMinor = item.gross_collected_minor
    const refundsAndReversalsMinor = item.refunds_and_reversals_minor
    const disputeDebitsMinor = item.dispute_debits_minor
    const disputeCreditsMinor = item.dispute_credits_minor
    const netCollectedMinor = item.net_collected_minor
    const netDependenciesWithheld =
      renewalCollectedMinor === null ||
      refundsAndReversalsMinor === null ||
      disputeDebitsMinor === null ||
      disputeCreditsMinor === null
    if (
      typeof currency !== "string" ||
      suppressed !== false ||
      !CURRENCY_SET.has(currency) ||
      (previousCurrency !== null && currency <= previousCurrency) ||
      !isSafeNonnegativeInteger(sponsorships) ||
      !isSafeNonnegativeInteger(uniqueSponsorContacts) ||
      uniqueSponsorContacts > sponsorships ||
      uniqueSponsorContacts < 5 ||
      !isSafeNonnegativeInteger(initialCollectedMinor) ||
      !isNullableSafeNonnegativeInteger(renewalCollectedMinor) ||
      !isNullableSafeNonnegativeInteger(grossCollectedMinor) ||
      !isNullableSafeNonnegativeInteger(refundsAndReversalsMinor) ||
      !isNullableSafeNonnegativeInteger(disputeDebitsMinor) ||
      !isNullableSafeNonnegativeInteger(disputeCreditsMinor) ||
      !isNullableSafeNonnegativeInteger(netCollectedMinor) ||
      (grossCollectedMinor === null) !== (renewalCollectedMinor === null) ||
      (netCollectedMinor === null) !== netDependenciesWithheld ||
      (renewalCollectedMinor !== null &&
        grossCollectedMinor !== null &&
        initialCollectedMinor + renewalCollectedMinor !==
          grossCollectedMinor) ||
      (grossCollectedMinor !== null &&
        refundsAndReversalsMinor !== null &&
        disputeDebitsMinor !== null &&
        disputeCreditsMinor !== null &&
        netCollectedMinor !== null &&
        grossCollectedMinor -
          refundsAndReversalsMinor -
          disputeDebitsMinor +
          disputeCreditsMinor !==
          netCollectedMinor)
    ) {
      return undefined
    }
    previousCurrency = currency
    currencies.push(
      Object.freeze({
        suppressed: false,
        currency: currency as AdvocateAnalyticsCurrency,
        sponsorships,
        uniqueSponsorContacts,
        initialCollectedMinor,
        renewalCollectedMinor,
        grossCollectedMinor,
        refundsAndReversalsMinor,
        disputeDebitsMinor,
        disputeCreditsMinor,
        netCollectedMinor,
      }),
    )
  }
  if (!hasConsistentNullMasks(currencies, CURRENCY_NULLABLE_FIELDS)) {
    return undefined
  }
  return Object.freeze(currencies)
}

export function parseAdvocateAnalyticsSnapshot(
  value: unknown,
): AdvocateAnalyticsSnapshot | null {
  if (!isRecord(value) || !hasExactKeys(value, SNAPSHOT_KEYS)) return null
  if (
    value.schema_version !== 1 ||
    typeof value.as_of !== "string" ||
    value.as_of.length > 64 ||
    !UTC_MIDNIGHT_PATTERN.test(value.as_of) ||
    !Number.isFinite(Date.parse(value.as_of)) ||
    !isRecord(value.methodology) ||
    !hasExactKeys(value.methodology, METHODOLOGY_KEYS) ||
    value.methodology.minimum_sponsor_contacts_per_cell !== 5 ||
    value.methodology.official_window_days !== 30 ||
    value.methodology.observed_window_days !== 365 ||
    value.methodology.renewals_increase_funds_not_counts !== true ||
    value.methodology.measure_suppression_enabled !== true
  ) {
    return null
  }

  const official = parseCell(value.official)
  const observed = parseCell(value.observed)
  const segments = parseSegments(value.segments)
  const originalCurrency = parseOriginalCurrency(value.original_currency)
  if (
    official === null ||
    observed === null ||
    segments === undefined ||
    originalCurrency === undefined
  ) {
    return null
  }

  return Object.freeze({
    schemaVersion: 1,
    asOf: value.as_of,
    methodology: Object.freeze({
      minimumSponsorContactsPerCell: 5,
      officialWindowDays: 30,
      observedWindowDays: 365,
      renewalsIncreaseFundsNotCounts: true,
      measureSuppressionEnabled: true,
    }),
    official,
    observed,
    segments,
    originalCurrency,
  })
}

export function createAdvocateAnalyticsRepository(
  client: SupabaseClient,
): AdvocateAnalyticsRepository {
  return {
    async load(advocateId) {
      const { data, error } = await client.rpc(
        "get_advocate_analytics_snapshot",
        { target_advocate_id: advocateId },
      )
      if (error) throw new AdvocateAnalyticsRepositoryError("query", error)

      const snapshot = parseAdvocateAnalyticsSnapshot(data)
      if (snapshot === null) {
        throw new AdvocateAnalyticsRepositoryError("shape")
      }
      return snapshot
    },
  }
}
