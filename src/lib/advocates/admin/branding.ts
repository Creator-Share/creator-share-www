import "server-only"

import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  sanitizeAdvocateAboutBiographyRichText,
  sanitizeAdvocateOpeningHeaderRichText,
} from "@/lib/advocates/richText"
import { normalizePublicSiteColor } from "@/lib/advocates/publicSiteTheme"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const LOGO_OBJECT_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/

const BRANDING_REQUEST_NAMESPACE = "b8bb12f5-c247-5ba6-a302-d4576e005042"

export const MAX_ADVOCATE_BRANDING_BODY_BYTES = 40_960

export interface AdvocateBrandingUpdateInput {
  expectedVersion: number
  primaryColor: string
  accentColor: string
  logoStoragePath: string | null
  logoAltText: string | null
  openingHeaderHtml: string
  aboutBiographyHtml: string
  changeReason: string
}

export interface AdvocateBrandingUpdateFailure {
  status: 400 | 403 | 404 | 409 | 500
  code:
    | "invalid_request"
    | "forbidden"
    | "portal_not_found"
    | "version_conflict"
    | "branding_update_failed"
}

export class AdvocateBrandingDatabaseError extends Error {
  readonly postgresCode: string | undefined

  constructor(cause: Readonly<{ code?: string }> | null) {
    super("advocate_branding_database_failure", { cause })
    this.name = "AdvocateBrandingDatabaseError"
    this.postgresCode = cause?.code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function boundedText(
  value: unknown,
  maximumLength: number,
  options: { allowEmpty: boolean; trim: boolean },
): string | null {
  if (typeof value !== "string" || CONTROL_CHARACTER_PATTERN.test(value)) {
    return null
  }
  const normalized = options.trim ? value.trim() : value
  if (
    normalized.length > maximumLength ||
    (!options.allowEmpty && normalized.length === 0)
  ) {
    return null
  }
  return normalized
}

function optionalLogoAltText(value: unknown): string | null | undefined {
  if (value === null) return null
  const normalized = boundedText(value, 300, {
    allowEmpty: false,
    trim: true,
  })
  return normalized ?? undefined
}

export function exactAdvocateLogoStoragePath(
  value: unknown,
  advocateSlug: string,
): string | null | undefined {
  if (value === null) return null
  if (
    typeof value !== "string" ||
    !SLUG_PATTERN.test(advocateSlug) ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return undefined
  }

  const segments = value.split("/")
  if (
    segments.length !== 3 ||
    segments[0] !== "logos" ||
    segments[1] !== advocateSlug ||
    !LOGO_OBJECT_PATTERN.test(segments[2])
  ) {
    return undefined
  }
  return value
}

export function parseAdvocateBrandingUpdateInput(
  rawBody: string,
  advocateSlug: string,
): AdvocateBrandingUpdateInput | null {
  if (
    typeof rawBody !== "string" ||
    new TextEncoder().encode(rawBody).byteLength >
      MAX_ADVOCATE_BRANDING_BODY_BYTES ||
    !SLUG_PATTERN.test(advocateSlug)
  ) {
    return null
  }

  let value: unknown
  try {
    value = JSON.parse(rawBody)
  } catch {
    return null
  }

  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "expectedVersion",
      "primaryColor",
      "accentColor",
      "logoStoragePath",
      "logoAltText",
      "openingHeaderHtml",
      "aboutBiographyHtml",
      "changeReason",
    ]) ||
    typeof value.expectedVersion !== "number" ||
    !Number.isSafeInteger(value.expectedVersion) ||
    value.expectedVersion < 1
  ) {
    return null
  }

  const primaryColor = normalizePublicSiteColor(value.primaryColor)
  const accentColor = normalizePublicSiteColor(value.accentColor)
  const logoStoragePath = exactAdvocateLogoStoragePath(
    value.logoStoragePath,
    advocateSlug,
  )
  const logoAltText = optionalLogoAltText(value.logoAltText)
  const changeReason = boundedText(value.changeReason, 500, {
    allowEmpty: false,
    trim: true,
  })
  if (
    primaryColor === null ||
    accentColor === null ||
    logoStoragePath === undefined ||
    logoAltText === undefined ||
    (logoStoragePath === null && logoAltText !== null) ||
    changeReason === null
  ) {
    return null
  }

  let openingHeaderHtml: string
  let aboutBiographyHtml: string
  try {
    openingHeaderHtml = sanitizeAdvocateOpeningHeaderRichText(
      value.openingHeaderHtml,
    )
    aboutBiographyHtml = sanitizeAdvocateAboutBiographyRichText(
      value.aboutBiographyHtml,
    )
  } catch {
    return null
  }

  return {
    expectedVersion: value.expectedVersion,
    primaryColor,
    accentColor,
    logoStoragePath,
    logoAltText,
    openingHeaderHtml,
    aboutBiographyHtml,
    changeReason,
  }
}

export async function readBoundedAdvocateBrandingBody(
  request: Pick<Request, "body" | "headers">,
): Promise<string | null> {
  const contentLength = request.headers.get("content-length")
  if (
    contentLength !== null &&
    (!/^[0-9]+$/.test(contentLength) ||
      Number(contentLength) > MAX_ADVOCATE_BRANDING_BODY_BYTES)
  ) {
    return null
  }
  if (request.body === null) return ""

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_ADVOCATE_BRANDING_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body)
  } catch {
    return null
  }
}

function uuidBytes(value: string): Buffer {
  return Buffer.from(value.replaceAll("-", ""), "hex")
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-")
}

export function deriveAdvocateBrandingRequestId(input: {
  actorUserId: string
  advocateId: string
  update: AdvocateBrandingUpdateInput
}): string | null {
  if (
    !UUID_PATTERN.test(input.actorUserId) ||
    !UUID_PATTERN.test(input.advocateId)
  ) {
    return null
  }

  const canonical = JSON.stringify({
    advocateId: input.advocateId,
    actorUserId: input.actorUserId,
    ...input.update,
  })
  const nameDigest = createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex")
  const digest = createHash("sha1")
    .update(uuidBytes(BRANDING_REQUEST_NAMESPACE))
    .update(Buffer.from(nameDigest, "hex"))
    .digest()
    .subarray(0, 16)
  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80
  return formatUuid(digest)
}

export function parseAdvocateBrandingUpdateResult(
  value: unknown,
  expectedVersion: number,
): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value === expectedVersion + 1
    ? value
    : null
}

export function classifyAdvocateBrandingUpdateFailure(
  postgresCode: string | undefined,
): AdvocateBrandingUpdateFailure {
  switch (postgresCode) {
    case "22023":
    case "23514":
      return { status: 400, code: "invalid_request" }
    case "28000":
    case "42501":
      return { status: 403, code: "forbidden" }
    case "23503":
      return { status: 404, code: "portal_not_found" }
    case "40001":
    case "55000":
      return { status: 409, code: "version_conflict" }
    default:
      return { status: 500, code: "branding_update_failed" }
  }
}

export async function updateAdvocateBranding(
  client: SupabaseClient,
  mutation: {
    advocateId: string
    actorUserId: string
    input: AdvocateBrandingUpdateInput
    logoUploadReservationId: string | null
    requestId: string
    traceId: string | null
    sessionId: string | null
  },
): Promise<number> {
  const { input } = mutation
  const { data, error } = await client.rpc("update_advocate_branding", {
    target_advocate_id: mutation.advocateId,
    target_actor_user_id: mutation.actorUserId,
    expected_advocate_version: input.expectedVersion,
    target_primary_color: input.primaryColor,
    target_accent_color: input.accentColor,
    target_logo_storage_path: input.logoStoragePath,
    target_logo_upload_reservation_id: mutation.logoUploadReservationId,
    target_logo_alt_text: input.logoAltText,
    target_opening_header_html: input.openingHeaderHtml,
    target_about_biography_html: input.aboutBiographyHtml,
    change_reason: input.changeReason,
    request_id: mutation.requestId,
    trace_id: mutation.traceId,
    session_id: mutation.sessionId,
  })
  if (error) throw new AdvocateBrandingDatabaseError(error)

  const version = parseAdvocateBrandingUpdateResult(data, input.expectedVersion)
  if (version === null) throw new AdvocateBrandingDatabaseError(null)
  return version
}
