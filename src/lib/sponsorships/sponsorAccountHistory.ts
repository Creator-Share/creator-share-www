import { Buffer } from "node:buffer"

export const SPONSOR_HISTORY_DEFAULT_PAGE_SIZE = 20
export const SPONSOR_HISTORY_MAX_PAGE_SIZE = 50

export type SponsorHistorySubjectKind = "standard" | "blind" | "partnership"
export type SponsorHistoryProject =
  "emergency" | "education" | "shelter" | "nutrition" | "general"
export type SponsorHistoryFinancialStatus =
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "partially_provider_reversed"
  | "provider_reversed"
  | "funds_withheld"

export interface SponsorOneTimeHistoryItem {
  sponsorshipIntentId: string
  subjectKind: SponsorHistorySubjectKind
  beneficiaryId: string | null
  beneficiaryName: string | null
  beneficiaryUsername: string | null
  partnershipProject: SponsorHistoryProject | null
  baseAmountUsdCents: number
  chargedAmountMinor: number
  chargedCurrency: "USD" | "AUD" | "GBP" | "EUR"
  netBaseAmountUsdCents: number
  netChargedAmountMinor: number
  provider: "STRIPE" | "PAYPAL"
  paidAt: string
  financialStatus: SponsorHistoryFinancialStatus
}

export interface SponsorAccountHistoryRequest {
  pageSize: number
  rpcLimit: number
  beforePaidAt: string | null
  beforeSponsorshipIntentId: string | null
}

export interface SponsorAccountHistoryPage {
  items: SponsorOneTimeHistoryItem[]
  nextCursor: string | null
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|([+-])(\d{2}):(\d{2}))$/
const SUBJECT_KINDS = new Set<SponsorHistorySubjectKind>([
  "standard",
  "blind",
  "partnership",
])
const PROJECTS = new Set<SponsorHistoryProject>([
  "emergency",
  "education",
  "shelter",
  "nutrition",
  "general",
])
const CURRENCIES = new Set(["USD", "AUD", "GBP", "EUR"] as const)
const PROVIDERS = new Set(["STRIPE", "PAYPAL"] as const)
const FINANCIAL_STATUSES = new Set<SponsorHistoryFinancialStatus>([
  "paid",
  "partially_refunded",
  "refunded",
  "partially_provider_reversed",
  "provider_reversed",
  "funds_withheld",
])
const CURSOR_KEYS = ["paidAt", "sponsorshipIntentId", "version"] as const

export class SponsorAccountHistoryError extends Error {
  constructor() {
    super("sponsor_account_history_unavailable")
    this.name = "SponsorAccountHistoryError"
  }
}

export class SponsorAccountHistoryRequestError extends Error {
  constructor() {
    super("invalid_sponsor_account_history_request")
    this.name = "SponsorAccountHistoryRequestError"
  }
}

function historyError(): never {
  throw new SponsorAccountHistoryError()
}

function requestError(): never {
  throw new SponsorAccountHistoryRequestError()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function requiredString(
  row: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string {
  const value = row[key]
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    /[\r\n\0]/.test(value)
  ) {
    historyError()
  }
  return value
}

function optionalString(
  row: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string | null {
  if (row[key] === null) return null
  return requiredString(row, key, maximumLength)
}

function safeDisplayText(
  row: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string | null {
  const raw = row[key]
  if (typeof raw !== "string") return null

  const normalized = raw
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
  if (!normalized) return null
  return Array.from(normalized).slice(0, maximumLength).join("")
}

function safeInteger(row: Record<string, unknown>, key: string): number {
  const raw = row[key]
  const value = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    historyError()
  }
  return value
}

function isTimestamp(value: string): boolean {
  const match = TIMESTAMP_PATTERN.exec(value)
  if (!match || !Number.isFinite(Date.parse(value))) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = match[8] ? Number(match[8]) : 0
  const offsetMinute = match[9] ? Number(match[9]) : 0
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return (
    year >= 2000 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 14 &&
    offsetMinute <= 59 &&
    (offsetHour < 14 || offsetMinute === 0)
  )
}

function validateFinancialShape(
  grossBase: number,
  grossCharged: number,
  netBase: number,
  netCharged: number,
  status: SponsorHistoryFinancialStatus,
): void {
  if (
    grossBase < 1 ||
    grossCharged < 1 ||
    netBase > grossBase ||
    netCharged > grossCharged
  ) {
    historyError()
  }

  const fullyPaid = netBase === grossBase && netCharged === grossCharged
  const fullyReduced = netCharged === 0
  const partiallyReduced = netCharged > 0 && netCharged < grossCharged

  if (
    (status === "paid" && !fullyPaid) ||
    ((status === "refunded" || status === "provider_reversed") &&
      !fullyReduced) ||
    ((status === "partially_refunded" ||
      status === "partially_provider_reversed") &&
      !partiallyReduced) ||
    (status === "funds_withheld" && fullyPaid)
  ) {
    historyError()
  }
}

function parseHistoryItem(value: unknown): SponsorOneTimeHistoryItem {
  if (!isRecord(value)) historyError()

  const sponsorshipIntentId = requiredString(value, "sponsorship_intent_id", 36)
  const subjectKind = requiredString(value, "subject_kind", 32)
  const beneficiaryId = optionalString(value, "beneficiary_id", 36)
  const partnershipProject = optionalString(value, "partnership_project", 32)
  const chargedCurrency = requiredString(value, "charged_currency", 3)
  const provider = requiredString(value, "provider", 16)
  const paidAt = requiredString(value, "paid_at", 64)
  const financialStatus = requiredString(value, "financial_status", 40)

  if (
    !UUID_PATTERN.test(sponsorshipIntentId) ||
    (beneficiaryId !== null && !UUID_PATTERN.test(beneficiaryId)) ||
    !SUBJECT_KINDS.has(subjectKind as SponsorHistorySubjectKind) ||
    (partnershipProject !== null &&
      !PROJECTS.has(partnershipProject as SponsorHistoryProject)) ||
    !CURRENCIES.has(
      chargedCurrency as SponsorOneTimeHistoryItem["chargedCurrency"],
    ) ||
    !PROVIDERS.has(provider as SponsorOneTimeHistoryItem["provider"]) ||
    !FINANCIAL_STATUSES.has(financialStatus as SponsorHistoryFinancialStatus) ||
    !isTimestamp(paidAt) ||
    (subjectKind === "standard" && beneficiaryId === null) ||
    (subjectKind !== "standard" && beneficiaryId !== null) ||
    (subjectKind === "partnership" && partnershipProject === null) ||
    (subjectKind !== "partnership" && partnershipProject !== null)
  ) {
    historyError()
  }

  const baseAmountUsdCents = safeInteger(value, "base_amount_usd_cents")
  const chargedAmountMinor = safeInteger(value, "charged_amount_minor")
  const netBaseAmountUsdCents = safeInteger(value, "net_base_amount_usd_cents")
  const netChargedAmountMinor = safeInteger(value, "net_charged_amount_minor")
  validateFinancialShape(
    baseAmountUsdCents,
    chargedAmountMinor,
    netBaseAmountUsdCents,
    netChargedAmountMinor,
    financialStatus as SponsorHistoryFinancialStatus,
  )

  return {
    sponsorshipIntentId,
    subjectKind: subjectKind as SponsorHistorySubjectKind,
    beneficiaryId,
    beneficiaryName: safeDisplayText(value, "beneficiary_name", 120),
    beneficiaryUsername: safeDisplayText(value, "beneficiary_username", 80),
    partnershipProject: partnershipProject as SponsorHistoryProject | null,
    baseAmountUsdCents,
    chargedAmountMinor,
    chargedCurrency:
      chargedCurrency as SponsorOneTimeHistoryItem["chargedCurrency"],
    netBaseAmountUsdCents,
    netChargedAmountMinor,
    provider: provider as SponsorOneTimeHistoryItem["provider"],
    paidAt,
    financialStatus: financialStatus as SponsorHistoryFinancialStatus,
  }
}

export function parseSponsorAccountHistoryRpcResult(
  value: unknown,
  maximumItems = 100,
): SponsorOneTimeHistoryItem[] {
  if (
    !Array.isArray(value) ||
    !Number.isInteger(maximumItems) ||
    maximumItems < 1 ||
    maximumItems > 100 ||
    value.length > maximumItems
  ) {
    historyError()
  }

  const items = value.map(parseHistoryItem)
  if (
    new Set(items.map((item) => item.sponsorshipIntentId)).size !== items.length
  ) {
    historyError()
  }
  return items
}

function encodeCursor(item: SponsorOneTimeHistoryItem): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      paidAt: item.paidAt,
      sponsorshipIntentId: item.sponsorshipIntentId,
    }),
    "utf8",
  ).toString("base64url")
}

function decodeCursor(cursor: string): {
  paidAt: string
  sponsorshipIntentId: string
} {
  if (
    cursor.length < 1 ||
    cursor.length > 512 ||
    !/^[A-Za-z0-9_-]+$/.test(cursor)
  ) {
    requestError()
  }

  let decoded: Buffer
  let value: unknown
  try {
    decoded = Buffer.from(cursor, "base64url")
    if (decoded.toString("base64url") !== cursor || decoded.length > 256) {
      requestError()
    }
    value = JSON.parse(decoded.toString("utf8"))
  } catch (error) {
    if (error instanceof SponsorAccountHistoryRequestError) throw error
    requestError()
  }

  if (
    !isRecord(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...CURSOR_KEYS].sort()) ||
    value.version !== 1 ||
    typeof value.paidAt !== "string" ||
    !isTimestamp(value.paidAt) ||
    typeof value.sponsorshipIntentId !== "string" ||
    !UUID_PATTERN.test(value.sponsorshipIntentId)
  ) {
    requestError()
  }

  return {
    paidAt: value.paidAt,
    sponsorshipIntentId: value.sponsorshipIntentId,
  }
}

export function parseSponsorAccountHistoryRequest(
  searchParams: URLSearchParams,
): SponsorAccountHistoryRequest {
  const allowed = new Set(["limit", "cursor"])
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) requestError()
  }
  if (
    searchParams.getAll("limit").length > 1 ||
    searchParams.getAll("cursor").length > 1
  ) {
    requestError()
  }

  const requestedLimit = searchParams.get("limit")
  const pageSize =
    requestedLimit === null
      ? SPONSOR_HISTORY_DEFAULT_PAGE_SIZE
      : /^[1-9]\d*$/.test(requestedLimit)
        ? Number(requestedLimit)
        : Number.NaN
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > SPONSOR_HISTORY_MAX_PAGE_SIZE
  ) {
    requestError()
  }

  const cursor = searchParams.get("cursor")
  const decoded = cursor === null ? null : decodeCursor(cursor)
  return {
    pageSize,
    rpcLimit: pageSize + 1,
    beforePaidAt: decoded?.paidAt ?? null,
    beforeSponsorshipIntentId: decoded?.sponsorshipIntentId ?? null,
  }
}

export function buildSponsorAccountHistoryPage(
  value: unknown,
  pageSize: number,
): SponsorAccountHistoryPage {
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > SPONSOR_HISTORY_MAX_PAGE_SIZE
  ) {
    historyError()
  }

  const parsed = parseSponsorAccountHistoryRpcResult(value, pageSize + 1)
  const items = parsed.slice(0, pageSize)
  return {
    items,
    nextCursor:
      parsed.length > pageSize && items.length > 0
        ? encodeCursor(items[items.length - 1])
        : null,
  }
}
