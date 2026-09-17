import "server-only"

import { createHash } from "node:crypto"

import {
  toSupabaseRpcBytea,
  type SponsorshipCrypto,
  type SupabaseRpcBytea,
} from "@/lib/sponsorships/crypto"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CAPABILITY_PATTERN = /^[0-9a-f]{64}$/
const ROLE_KEYS = new Set([
  "administrator",
  "brand_editor",
  "catalog_curator",
  "analytics_viewer",
  "audit_viewer",
])
const DELEGATE_TEMPLATE_KEYS = new Set([
  "advocate_display_name",
  "invitation_id",
  "role_keys",
])
const INITIAL_OWNER_TEMPLATE_KEYS = new Set([
  "advocate_display_name",
  "invitation_id",
])
const MAXIMUM_TEMPLATE_DATA_BYTES = 4_096
const MAXIMUM_SECRET_PAYLOAD_BYTES = 4_096

export type AdvocateInvitationEmailTemplateKey =
  "advocate_delegate_invitation_v1" | "advocate_initial_owner_invitation_v1"

export interface AdvocateDelegateInvitationEmailTemplateData {
  templateKey: "advocate_delegate_invitation_v1"
  advocateDisplayName: string
  invitationId: string
  roleKeys: readonly string[]
}

export interface AdvocateInitialOwnerInvitationEmailTemplateData {
  templateKey: "advocate_initial_owner_invitation_v1"
  advocateDisplayName: string
  invitationId: string
}

export type AdvocateInvitationEmailTemplateData =
  | AdvocateDelegateInvitationEmailTemplateData
  | AdvocateInitialOwnerInvitationEmailTemplateData

export interface AdvocateInvitationSecretMaterial {
  capability: string
  capabilityDigest: SupabaseRpcBytea
}

export class AdvocateInvitationEmailEnvelopeError extends Error {
  constructor() {
    super("advocate_invitation_email_envelope_invalid")
    this.name = "AdvocateInvitationEmailEnvelopeError"
  }
}

function envelopeError(): never {
  throw new AdvocateInvitationEmailEnvelopeError()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function parseAdvocateInvitationEmailTemplateData(
  templateKey: AdvocateInvitationEmailTemplateKey,
  value: unknown,
): AdvocateInvitationEmailTemplateData {
  if (!isRecord(value)) envelopeError()

  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    envelopeError()
  }
  if (
    Buffer.byteLength(encoded, "utf8") > MAXIMUM_TEMPLATE_DATA_BYTES ||
    (templateKey === "advocate_delegate_invitation_v1"
      ? Object.keys(value).length !== DELEGATE_TEMPLATE_KEYS.size ||
        Object.keys(value).some((key) => !DELEGATE_TEMPLATE_KEYS.has(key))
      : Object.keys(value).length !== INITIAL_OWNER_TEMPLATE_KEYS.size ||
        Object.keys(value).some((key) => !INITIAL_OWNER_TEMPLATE_KEYS.has(key)))
  ) {
    envelopeError()
  }

  const advocateDisplayName = value.advocate_display_name
  const invitationId = value.invitation_id
  const roleKeys = value.role_keys
  if (
    typeof advocateDisplayName !== "string" ||
    advocateDisplayName !== advocateDisplayName.trim() ||
    advocateDisplayName.length < 1 ||
    advocateDisplayName.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(advocateDisplayName) ||
    typeof invitationId !== "string" ||
    !UUID_PATTERN.test(invitationId) ||
    (templateKey === "advocate_delegate_invitation_v1" &&
      (!Array.isArray(roleKeys) ||
        roleKeys.length < 1 ||
        roleKeys.length > ROLE_KEYS.size ||
        roleKeys.some(
          (role) =>
            typeof role !== "string" ||
            !ROLE_KEYS.has(role) ||
            role !== role.trim(),
        ) ||
        new Set(roleKeys).size !== roleKeys.length ||
        [...roleKeys].sort().some((role, index) => role !== roleKeys[index])))
  ) {
    envelopeError()
  }

  if (templateKey === "advocate_initial_owner_invitation_v1") {
    return Object.freeze({
      templateKey,
      advocateDisplayName,
      invitationId,
    })
  }

  return Object.freeze({
    templateKey,
    advocateDisplayName,
    invitationId,
    roleKeys: Object.freeze([...(roleKeys as string[])]),
  })
}

export function openAdvocateInvitationSecretMaterial(
  plaintext: Uint8Array,
): AdvocateInvitationSecretMaterial {
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
    typeof payload.capability !== "string" ||
    !CAPABILITY_PATTERN.test(payload.capability) ||
    decoded !== JSON.stringify({ version: 1, capability: payload.capability })
  ) {
    envelopeError()
  }

  return Object.freeze({
    capability: payload.capability,
    capabilityDigest: toSupabaseRpcBytea(
      createHash("sha256").update(payload.capability, "utf8").digest(),
    ),
  })
}

export function createAdvocateInvitationSecretEnvelope(
  capability: string,
  crypto: SponsorshipCrypto,
): SupabaseRpcBytea {
  if (!CAPABILITY_PATTERN.test(capability)) envelopeError()
  return crypto.encryptSecretPayload(JSON.stringify({ version: 1, capability }))
    .ciphertextRpcBytea
}
