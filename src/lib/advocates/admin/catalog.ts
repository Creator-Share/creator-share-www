import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { ALL_STATUSES } from "@/config/beneficiaryStatuses"
import {
  isValidBeneficiaryUsername,
  isWithinPublicBeneficiaryTextByteLimit,
} from "@/config/beneficiaryValidation"
import {
  isAdvocateCatalogMode,
  isValidAdvocateCatalogConfiguration,
  MAX_ADVOCATE_CATALOG_SELECTIONS,
  normalizeAdvocateCatalogSelections,
  type AdvocateCatalogChoice,
  type AdvocateCatalogMode,
} from "@/lib/advocates/admin/catalogForm"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/
const STATUS_SET = new Set<string>(ALL_STATUSES)

export const MAX_ADVOCATE_CATALOG_BODY_BYTES = 131_072

export interface AdvocateCatalogAdministration {
  advocateVersion: number
  mode: AdvocateCatalogMode
  selections: readonly {
    beneficiaryId: string
    isFeatured: boolean
  }[]
  selectionLimit: number
  beneficiaries: readonly AdvocateCatalogChoice[]
}

export interface AdvocateCatalogUpdateInput {
  expectedVersion: number
  mode: AdvocateCatalogMode
  beneficiaryIds: readonly string[]
  featuredBeneficiaryIds: readonly string[]
  changeReason: string
}

export interface AdvocateCatalogUpdateFailure {
  status: 400 | 403 | 404 | 409 | 500
  code:
    | "invalid_request"
    | "forbidden"
    | "portal_not_found"
    | "no_change"
    | "eligibility_changed"
    | "version_conflict"
    | "catalog_update_failed"
}

export class AdvocateCatalogDatabaseError extends Error {
  readonly stage: "read" | "read_shape" | "update" | "update_shape"
  readonly postgresCode: string | undefined
  readonly postgresMessage: string | undefined

  constructor(
    stage: "read" | "read_shape" | "update" | "update_shape",
    cause: Readonly<{ code?: string; message?: string }> | null = null,
  ) {
    super("advocate_catalog_database_failure", { cause })
    this.name = "AdvocateCatalogDatabaseError"
    this.stage = stage
    this.postgresCode = cause?.code
    this.postgresMessage = cause?.message
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isBoundedAuditText(
  value: unknown,
  maximumLength: number,
  required: boolean,
): value is string | null {
  if (value === null) return !required
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= (required ? 1 : 0) &&
    value.length <= maximumLength &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  )
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

function isBoundedBeneficiaryName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    isWithinPublicBeneficiaryTextByteLimit(value, 300) &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  )
}

function parseCatalogChoice(value: unknown): AdvocateCatalogChoice | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "id",
      "name",
      "username",
      "status",
      "eligible",
      "blocked_reason",
    ]) ||
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    typeof value.eligible !== "boolean"
  ) {
    return null
  }

  const safeName = isBoundedBeneficiaryName(value.name)
  const safeUsername = isValidBeneficiaryUsername(value.username)
  const safeStatus =
    typeof value.status === "string" && STATUS_SET.has(value.status)
  if (
    (value.eligible &&
      (!safeName ||
        !safeUsername ||
        !safeStatus ||
        value.blocked_reason !== null)) ||
    (!value.eligible &&
      (value.blocked_reason !== "unavailable" ||
        value.name !== null ||
        value.username !== null ||
        value.status !== null))
  ) {
    return null
  }

  return Object.freeze({
    id: value.id,
    name: value.name as string | null,
    username: value.username as string | null,
    status: value.status as string | null,
    eligible: value.eligible,
    blockedReason: value.blocked_reason as "unavailable" | null,
  })
}

function parseCatalogSelections(
  value: unknown,
): readonly { beneficiaryId: string; isFeatured: boolean }[] | null {
  if (!Array.isArray(value) || value.length > MAX_ADVOCATE_CATALOG_SELECTIONS) {
    return null
  }
  const selections: { beneficiaryId: string; isFeatured: boolean }[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ["beneficiary_id", "is_featured"]) ||
      typeof candidate.beneficiary_id !== "string" ||
      !UUID_PATTERN.test(candidate.beneficiary_id) ||
      seen.has(candidate.beneficiary_id) ||
      typeof candidate.is_featured !== "boolean"
    ) {
      return null
    }
    seen.add(candidate.beneficiary_id)
    selections.push(
      Object.freeze({
        beneficiaryId: candidate.beneficiary_id,
        isFeatured: candidate.is_featured,
      }),
    )
  }
  return Object.freeze(selections)
}

export function parseAdvocateCatalogAdministration(
  value: unknown,
): AdvocateCatalogAdministration | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "advocate_version",
      "beneficiary_mode",
      "beneficiary_selections",
      "beneficiaries",
      "selection_limit",
    ]) ||
    typeof value.advocate_version !== "number" ||
    !Number.isSafeInteger(value.advocate_version) ||
    value.advocate_version < 1 ||
    !isAdvocateCatalogMode(value.beneficiary_mode) ||
    value.selection_limit !== MAX_ADVOCATE_CATALOG_SELECTIONS ||
    !Array.isArray(value.beneficiaries) ||
    value.beneficiaries.length > MAX_ADVOCATE_CATALOG_SELECTIONS * 2
  ) {
    return null
  }

  const selections = parseCatalogSelections(value.beneficiary_selections)
  if (selections === null) return null

  const beneficiaries: AdvocateCatalogChoice[] = []
  const seen = new Set<string>()
  for (const rawChoice of value.beneficiaries) {
    const choice = parseCatalogChoice(rawChoice)
    if (choice === null || seen.has(choice.id)) return null
    seen.add(choice.id)
    beneficiaries.push(choice)
  }

  if (
    !isValidAdvocateCatalogConfiguration(value.beneficiary_mode, selections) ||
    selections.some((selection) => !seen.has(selection.beneficiaryId))
  ) {
    return null
  }

  return Object.freeze({
    advocateVersion: value.advocate_version,
    mode: value.beneficiary_mode,
    selections,
    selectionLimit: MAX_ADVOCATE_CATALOG_SELECTIONS,
    beneficiaries: Object.freeze(beneficiaries),
  })
}

function normalizeUniqueUuidArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ADVOCATE_CATALOG_SELECTIONS) {
    return null
  }
  const values: string[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    if (
      typeof candidate !== "string" ||
      !UUID_PATTERN.test(candidate) ||
      seen.has(candidate)
    ) {
      return null
    }
    seen.add(candidate)
    values.push(candidate)
  }
  return Object.freeze(values)
}

export function parseAdvocateCatalogUpdateInput(
  rawBody: string,
): AdvocateCatalogUpdateInput | null {
  if (
    typeof rawBody !== "string" ||
    new TextEncoder().encode(rawBody).byteLength >
      MAX_ADVOCATE_CATALOG_BODY_BYTES
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
      "mode",
      "beneficiaryIds",
      "featuredBeneficiaryIds",
      "changeReason",
    ]) ||
    typeof value.expectedVersion !== "number" ||
    !Number.isSafeInteger(value.expectedVersion) ||
    value.expectedVersion < 1 ||
    !isAdvocateCatalogMode(value.mode) ||
    typeof value.changeReason !== "string"
  ) {
    return null
  }

  const beneficiaryIds = normalizeUniqueUuidArray(value.beneficiaryIds)
  const featuredBeneficiaryIds = normalizeUniqueUuidArray(
    value.featuredBeneficiaryIds,
  )
  const changeReason = value.changeReason.trim()
  if (
    beneficiaryIds === null ||
    featuredBeneficiaryIds === null ||
    changeReason.length < 1 ||
    changeReason.length > 500 ||
    CONTROL_CHARACTER_PATTERN.test(changeReason)
  ) {
    return null
  }

  const selectedIds = new Set(beneficiaryIds)
  if (
    featuredBeneficiaryIds.some((id) => !selectedIds.has(id)) ||
    (value.mode === "all_featured" &&
      (beneficiaryIds.length !== featuredBeneficiaryIds.length ||
        beneficiaryIds.some((id) => !featuredBeneficiaryIds.includes(id))))
  ) {
    return null
  }
  const featuredIds = new Set(featuredBeneficiaryIds)
  const selections = normalizeAdvocateCatalogSelections(
    beneficiaryIds.map((beneficiaryId) => ({
      beneficiaryId,
      isFeatured: featuredIds.has(beneficiaryId),
    })),
  )
  if (
    selections === null ||
    !isValidAdvocateCatalogConfiguration(value.mode, selections)
  ) {
    return null
  }

  return Object.freeze({
    expectedVersion: value.expectedVersion,
    mode: value.mode,
    beneficiaryIds,
    featuredBeneficiaryIds,
    changeReason,
  })
}

export async function readBoundedAdvocateCatalogBody(
  request: Pick<Request, "body" | "headers">,
): Promise<string | null> {
  const contentLength = request.headers.get("content-length")
  if (
    contentLength !== null &&
    (!/^[0-9]+$/.test(contentLength) ||
      Number(contentLength) > MAX_ADVOCATE_CATALOG_BODY_BYTES)
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
      if (totalBytes > MAX_ADVOCATE_CATALOG_BODY_BYTES) {
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

export function classifyAdvocateCatalogUpdateFailure(
  postgresCode: string | undefined,
  postgresMessage: string | undefined,
): AdvocateCatalogUpdateFailure {
  if (
    postgresCode === "22023" &&
    postgresMessage === "Advocate beneficiary configuration is unchanged"
  ) {
    return { status: 409, code: "no_change" }
  }
  switch (postgresCode) {
    case "22023":
      return { status: 400, code: "invalid_request" }
    case "23514":
      return { status: 409, code: "eligibility_changed" }
    case "28000":
    case "42501":
      return { status: 403, code: "forbidden" }
    case "23503":
      return { status: 404, code: "portal_not_found" }
    case "40001":
    case "55000":
      return { status: 409, code: "version_conflict" }
    default:
      return { status: 500, code: "catalog_update_failed" }
  }
}

export async function loadAdvocateCatalogAdministration(
  client: SupabaseClient,
  input: { advocateId: string; actorUserId: string },
): Promise<AdvocateCatalogAdministration> {
  if (
    !UUID_PATTERN.test(input.advocateId) ||
    !UUID_PATTERN.test(input.actorUserId)
  ) {
    throw new AdvocateCatalogDatabaseError("read_shape")
  }
  const { data, error } = await client.rpc(
    "read_advocate_catalog_administration",
    {
      target_advocate_id: input.advocateId,
      acting_user_id: input.actorUserId,
    },
  )
  if (error) throw new AdvocateCatalogDatabaseError("read", error)
  const result = parseAdvocateCatalogAdministration(data)
  if (result === null) throw new AdvocateCatalogDatabaseError("read_shape")
  return result
}

export async function replaceAdvocateCatalogConfiguration(
  client: SupabaseClient,
  mutation: {
    advocateId: string
    actorUserId: string
    input: AdvocateCatalogUpdateInput
    requestId: string
    traceId: string
    sessionId: null
    clientIp: string | null
    userAgent: string | null
  },
): Promise<number> {
  if (
    !UUID_PATTERN.test(mutation.advocateId) ||
    !UUID_PATTERN.test(mutation.actorUserId) ||
    !UUID_PATTERN.test(mutation.requestId) ||
    !isBoundedAuditText(mutation.traceId, 255, true) ||
    mutation.sessionId !== null ||
    !isBoundedAuditText(mutation.clientIp, 256, false) ||
    !isBoundedAuditText(mutation.userAgent, 1_024, false)
  ) {
    throw new AdvocateCatalogDatabaseError("update_shape")
  }

  const { data, error } = await client.rpc(
    "replace_advocate_beneficiary_configuration",
    {
      target_advocate_id: mutation.advocateId,
      acting_user_id: mutation.actorUserId,
      expected_advocate_version: mutation.input.expectedVersion,
      target_beneficiary_mode: mutation.input.mode,
      target_beneficiary_ids: mutation.input.beneficiaryIds,
      target_featured_beneficiary_ids: mutation.input.featuredBeneficiaryIds,
      change_reason: mutation.input.changeReason,
      request_id: mutation.requestId,
      trace_id: mutation.traceId,
      session_id: mutation.sessionId,
      client_ip: mutation.clientIp,
      user_agent: mutation.userAgent,
    },
  )
  if (error) throw new AdvocateCatalogDatabaseError("update", error)
  if (
    typeof data !== "number" ||
    !Number.isSafeInteger(data) ||
    data !== mutation.input.expectedVersion + 1
  ) {
    throw new AdvocateCatalogDatabaseError("update_shape")
  }
  return data
}
