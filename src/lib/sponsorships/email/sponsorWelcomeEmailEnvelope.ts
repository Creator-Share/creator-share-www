import "server-only"

import {
  type SponsorshipCrypto,
  type SupabaseRpcBytea,
  toSupabaseRpcBytea,
} from "@/lib/sponsorships/crypto"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/
const TEMPLATE_KEYS = new Set([
  "subject_kind",
  "beneficiary_id",
  "partnership_project",
  "payment_mode",
  "recurrence_interval",
  "locale",
])
const MAXIMUM_TEMPLATE_DATA_BYTES = 4096
const MAXIMUM_SECRET_PAYLOAD_BYTES = 4096

export interface SponsorWelcomeTemplateData {
  subjectKind: "standard" | "blind"
  beneficiaryId: string | null
  partnershipProject: null
  paymentMode: "one_time" | "recurring"
  recurrenceInterval: "month" | "year" | null
  locale: string | null
}

export interface SponsorWelcomeSecretMaterial {
  claimToken: string
  claimTokenDigest: SupabaseRpcBytea
}

export class SponsorWelcomeEmailEnvelopeError extends Error {
  constructor() {
    super("sponsor_welcome_email_envelope_invalid")
    this.name = "SponsorWelcomeEmailEnvelopeError"
  }
}

function envelopeError(): never {
  throw new SponsorWelcomeEmailEnvelopeError()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const candidate = value[key]
  if (candidate === undefined) return null
  if (
    typeof candidate !== "string" ||
    candidate.length < 1 ||
    candidate.length > 120 ||
    candidate !== candidate.trim()
  ) {
    envelopeError()
  }
  return candidate
}

export function parseSponsorWelcomeTemplateData(
  value: unknown,
): SponsorWelcomeTemplateData {
  if (!isRecord(value)) envelopeError()

  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    envelopeError()
  }
  if (Buffer.byteLength(encoded, "utf8") > MAXIMUM_TEMPLATE_DATA_BYTES) {
    envelopeError()
  }
  if (Object.keys(value).some((key) => !TEMPLATE_KEYS.has(key))) {
    envelopeError()
  }

  const subjectKind = value.subject_kind
  if (subjectKind !== "standard" && subjectKind !== "blind") {
    envelopeError()
  }

  const paymentMode = value.payment_mode
  if (paymentMode !== "one_time" && paymentMode !== "recurring") {
    envelopeError()
  }

  const beneficiaryId = optionalString(value, "beneficiary_id")
  const partnershipProject = optionalString(value, "partnership_project")
  const recurrenceInterval = optionalString(value, "recurrence_interval")
  const locale = optionalString(value, "locale")

  if (
    (subjectKind === "standard" &&
      (beneficiaryId === null || !UUID_PATTERN.test(beneficiaryId))) ||
    (subjectKind !== "standard" && beneficiaryId !== null) ||
    partnershipProject !== null ||
    (paymentMode === "one_time" && recurrenceInterval !== null) ||
    (paymentMode === "recurring" &&
      recurrenceInterval !== "month" &&
      recurrenceInterval !== "year") ||
    (locale !== null && (locale.length > 35 || !LOCALE_PATTERN.test(locale)))
  ) {
    envelopeError()
  }

  return {
    subjectKind,
    beneficiaryId,
    partnershipProject: null,
    paymentMode,
    recurrenceInterval:
      recurrenceInterval as SponsorWelcomeTemplateData["recurrenceInterval"],
    locale,
  }
}

export function openSponsorWelcomeSecretMaterial(
  plaintext: Uint8Array,
  crypto: SponsorshipCrypto,
): SponsorWelcomeSecretMaterial {
  if (
    !(plaintext instanceof Uint8Array) ||
    plaintext.byteLength < 1 ||
    plaintext.byteLength > MAXIMUM_SECRET_PAYLOAD_BYTES
  ) {
    envelopeError()
  }

  let decoded: string
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(plaintext)
  } catch {
    envelopeError()
  }

  let payload: unknown
  try {
    payload = JSON.parse(decoded)
  } catch {
    envelopeError()
  }
  if (
    !isRecord(payload) ||
    Object.keys(payload).length !== 2 ||
    payload.version !== 1 ||
    typeof payload.claimToken !== "string"
  ) {
    envelopeError()
  }

  let claimTokenDigest: SupabaseRpcBytea
  try {
    if (
      decoded !== JSON.stringify({ version: 1, claimToken: payload.claimToken })
    ) {
      envelopeError()
    }
    claimTokenDigest = toSupabaseRpcBytea(
      crypto.digestOpaqueToken(payload.claimToken),
    )
  } catch {
    envelopeError()
  }

  return { claimToken: payload.claimToken, claimTokenDigest }
}
