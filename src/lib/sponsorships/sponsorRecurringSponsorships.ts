import {
  presentSubscriptionSubject,
  type SubscriptionPartnershipProject,
  type SubscriptionSubjectPresentation,
  type SubscriptionSubjectKind,
} from "@/lib/sponsorships/subscriptionPresentation"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ROW_KEYS = [
  "amount_usd_cents",
  "beneficiary_id",
  "beneficiary_name",
  "beneficiary_username",
  "current_period_end",
  "partnership_project",
  "recurrence_interval",
  "subject_kind",
  "subscription_id",
  "subscription_status",
] as const
const STATUSES = new Set(["complete", "incomplete", "cancelled"])
const SUBJECT_KINDS = new Set<SubscriptionSubjectKind>([
  "standard",
  "blind",
  "partnership",
])
const PROJECTS = new Set<SubscriptionPartnershipProject>([
  "emergency",
  "education",
  "shelter",
  "nutrition",
  "general",
])

export interface SponsorRecurringSponsorship {
  id: string
  beneficiary_id: string | null
  status: "complete" | "incomplete" | "cancelled"
  amount: number
  interval: string
  current_period_end: string | null
  subject_kind: SubscriptionSubjectKind | null
  partnership_project: SubscriptionPartnershipProject | null
  child: {
    name: string
    username: string | null
  } | null
}

export interface SponsorRecurringSponsorshipSummary {
  completed: readonly SponsorRecurringSponsorship[]
  blind: readonly SponsorRecurringSponsorship[]
  partnerships: readonly SponsorRecurringSponsorship[]
  matched: readonly SponsorRecurringSponsorship[]
}

function subjectFor(
  subscription: SponsorRecurringSponsorship,
): SubscriptionSubjectPresentation {
  return presentSubscriptionSubject({
    subjectKind: subscription.subject_kind,
    partnershipProject: subscription.partnership_project,
    beneficiaryId: subscription.beneficiary_id,
  })
}

export function summarizeSponsorRecurringSponsorships(
  subscriptions: readonly SponsorRecurringSponsorship[],
): SponsorRecurringSponsorshipSummary {
  const completed = subscriptions.filter(
    (subscription) => subscription.status === "complete",
  )
  return {
    completed,
    blind: completed.filter(
      (subscription) => subjectFor(subscription).subjectKind === "blind",
    ),
    partnerships: completed.filter(
      (subscription) =>
        subjectFor(subscription).subjectKind === "partnership",
    ),
    matched: completed.filter(
      (subscription) =>
        subjectFor(subscription).subjectKind === "standard" &&
        subscription.beneficiary_id !== null,
    ),
  }
}

export class SponsorRecurringSponsorshipError extends Error {
  constructor() {
    super("sponsor_recurring_sponsorships_unavailable")
    this.name = "SponsorRecurringSponsorshipError"
  }
}

function unavailable(): never {
  throw new SponsorRecurringSponsorshipError()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function optionalText(
  row: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string | null {
  const value = row[key]
  if (value === null) return null
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    /[\r\n\0]/.test(value)
  ) {
    unavailable()
  }
  return value
}

function requiredText(
  row: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string {
  return optionalText(row, key, maximumLength) ?? unavailable()
}

function parseRow(value: unknown): SponsorRecurringSponsorship {
  if (!isRecord(value)) unavailable()
  if (Object.keys(value).sort().join("\0") !== ROW_KEYS.join("\0")) {
    unavailable()
  }

  const id = requiredText(value, "subscription_id", 36)
  const beneficiaryId = optionalText(value, "beneficiary_id", 36)
  const status = requiredText(value, "subscription_status", 20)
  const interval = requiredText(value, "recurrence_interval", 20)
  const subjectKind = optionalText(value, "subject_kind", 32)
  const partnershipProject = optionalText(value, "partnership_project", 32)
  const beneficiaryName = optionalText(value, "beneficiary_name", 120)
  const beneficiaryUsername = optionalText(value, "beneficiary_username", 80)
  const amount = value.amount_usd_cents
  const currentPeriodEnd = value.current_period_end

  if (
    !UUID_PATTERN.test(id) ||
    (beneficiaryId !== null && !UUID_PATTERN.test(beneficiaryId)) ||
    !STATUSES.has(status) ||
    typeof amount !== "number" ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    (currentPeriodEnd !== null &&
      (typeof currentPeriodEnd !== "string" ||
        !Number.isFinite(Date.parse(currentPeriodEnd)))) ||
    (subjectKind !== null &&
      !SUBJECT_KINDS.has(subjectKind as SubscriptionSubjectKind)) ||
    (partnershipProject !== null &&
      !PROJECTS.has(partnershipProject as SubscriptionPartnershipProject)) ||
    (subjectKind === "partnership" && partnershipProject === null) ||
    (subjectKind !== "partnership" && partnershipProject !== null) ||
    (beneficiaryName === null && beneficiaryUsername !== null)
  ) {
    unavailable()
  }

  return {
    id,
    beneficiary_id: beneficiaryId,
    status: status as SponsorRecurringSponsorship["status"],
    amount,
    interval,
    current_period_end: currentPeriodEnd as string | null,
    subject_kind: subjectKind as SubscriptionSubjectKind | null,
    partnership_project:
      partnershipProject as SubscriptionPartnershipProject | null,
    child:
      beneficiaryName === null
        ? null
        : { name: beneficiaryName, username: beneficiaryUsername },
  }
}

export function parseSponsorRecurringSponsorships(
  value: unknown,
): SponsorRecurringSponsorship[] {
  if (!Array.isArray(value)) unavailable()
  return value.map(parseRow)
}
