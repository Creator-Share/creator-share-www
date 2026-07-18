import "server-only"

import { createHash } from "node:crypto"

import { BENEFICIARY_TYPES, type BeneficiaryType } from "@/types/admin.types"
import { PUBLIC_STATUSES, type Status } from "@/config/beneficiaryStatuses"
import {
  isValidBeneficiaryUsername,
  isWithinPublicBeneficiaryTextByteLimit,
  MAX_BENEFICIARY_USERNAME_LENGTH,
} from "@/config/beneficiaryValidation"
import type {
  Beneficiaries,
  BeneficiaryMedia,
  BeneficiaryMetadata,
  Gender,
} from "@/types"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const DATABASE_BENEFICIARY_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const STRICT_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/
const MULTILINE_TEXT_FORBIDDEN_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/
const MAX_CURSOR_LENGTH = 1_024
const MAX_SEARCH_LENGTH = 100
const MAX_LIMIT = 60
const DEFAULT_LIMIT = 9
const MAX_AGE = 130
const MAX_DISPLAY_ORDER = 2_147_483_647
const MAX_MEDIA_ITEMS = 500
const MAX_ACTIVITY_ITEMS = 100
const MAX_ACTIVITY_MEDIA_ITEMS = 500
const MAX_TOTAL_ACTIVITY_MEDIA_ITEMS = 500

const BENEFICIARY_TYPE_SET = new Set<string>(BENEFICIARY_TYPES)
const RESPONSE_STATUS_SET = new Set<string>(PUBLIC_STATUSES)
const PUBLIC_FILTER_STATUS_SET = new Set<string>([
  "New",
  "Partially Funded",
  "Budget Fulfilled",
  "Sponsorship Cancelled",
] satisfies readonly Status[])
const ACTIVITY_TYPE_SET = new Set(["INFO", "UPDATE", "SUBSCRIPTION"])
const MEDIA_TYPE_SET = new Set(["IMAGE", "VIDEO", "DOCUMENT"])

export type PublicCatalogKind = "primary" | "advocate"

export interface PublicCatalogFilters {
  beneficiaryTypes: readonly BeneficiaryType[]
  gender: Gender | null
  statuses: readonly Status[]
  minimumAge: number | null
  maximumAge: number | null
  search: string | null
  limit: number
}

export interface PublicCatalogCursorComponents {
  featureBucket: number
  displayOrder: number
  createdAt: string
  id: string
}

export interface PublicCatalogRequest {
  filters: PublicCatalogFilters
  cursor: PublicCatalogCursorComponents | null
}

export interface PublicCatalogPage {
  people: Beneficiaries[]
  totalCount: number
  pageInfo: {
    limit: number
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface PublicCatalogActivity {
  id: string
  created_at: string
  description: string | null
  beneficiary_id: string
  title: string | null
  activity_type: "INFO" | "UPDATE" | "SUBSCRIPTION" | null
  media: BeneficiaryMedia[]
}

type CursorEnvelope = {
  v: 1
  host: string
  filters: string
  featureBucket: number
  displayOrder: number
  createdAt: string
  id: string
}

export class PublicCatalogRequestError extends Error {
  readonly field: string

  constructor(field: string) {
    super("invalid_public_catalog_request")
    this.name = "PublicCatalogRequestError"
    this.field = field
  }
}

export class PublicCatalogShapeError extends Error {
  readonly stage: string

  constructor(stage: string) {
    super("invalid_public_catalog_shape")
    this.name = "PublicCatalogShapeError"
    this.stage = stage
  }
}

export function isPublicBeneficiaryUsername(value: unknown): value is string {
  return isValidBeneficiaryUsername(value)
}

export function isPublicBeneficiaryId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const keys = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  )
}

function stableUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort()
}

function parseCommaList<T extends string>(
  raw: string | null,
  allowed: ReadonlySet<string>,
  field: string,
): T[] {
  if (raw === null || raw === "") return []
  if (raw.length > 500 || STRICT_CONTROL_CHARACTER_PATTERN.test(raw)) {
    throw new PublicCatalogRequestError(field)
  }

  const values = raw.split(",").map((value) => value.trim())
  if (
    values.length === 0 ||
    values.some((value) => value.length === 0 || !allowed.has(value))
  ) {
    throw new PublicCatalogRequestError(field)
  }
  return stableUnique(values as T[])
}

function parseGender(raw: string | null): Gender | null {
  if (raw === null || raw === "") return null
  if (raw !== "Boy" && raw !== "Girl") {
    throw new PublicCatalogRequestError("gender")
  }
  return raw
}

function parseAgeRange(raw: string | null): {
  minimumAge: number | null
  maximumAge: number | null
} {
  if (raw === null || raw === "") {
    return { minimumAge: null, maximumAge: null }
  }
  if (!/^\d{1,3},\d{1,3}$/.test(raw)) {
    throw new PublicCatalogRequestError("ageRange")
  }

  const [first, second] = raw.split(",").map(Number)
  if (
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(second) ||
    first < 0 ||
    second < 0 ||
    first > MAX_AGE ||
    second > MAX_AGE
  ) {
    throw new PublicCatalogRequestError("ageRange")
  }

  return {
    minimumAge: Math.min(first, second),
    maximumAge: Math.max(first, second),
  }
}

function parseSearch(raw: string | null): string | null {
  if (raw === null) return null
  const search = raw.trim()
  if (search === "") return null
  if (
    search.length > MAX_SEARCH_LENGTH ||
    STRICT_CONTROL_CHARACTER_PATTERN.test(search)
  ) {
    throw new PublicCatalogRequestError("search")
  }
  return search
}

function parseLimit(raw: string | null): number {
  if (raw === null || raw === "") return DEFAULT_LIMIT
  if (!/^\d{1,2}$/.test(raw)) {
    throw new PublicCatalogRequestError("limit")
  }
  const limit = Number(raw)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new PublicCatalogRequestError("limit")
  }
  return limit
}

function filterDigest(filters: PublicCatalogFilters): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        beneficiaryTypes: filters.beneficiaryTypes,
        gender: filters.gender,
        statuses: filters.statuses,
        minimumAge: filters.minimumAge,
        maximumAge: filters.maximumAge,
        search: filters.search,
        limit: filters.limit,
      }),
      "utf8",
    )
    .digest("base64url")
}

function parseCursorEnvelope(
  raw: string,
  hostname: string,
  filters: PublicCatalogFilters,
): CursorEnvelope {
  if (
    raw.length === 0 ||
    raw.length > MAX_CURSOR_LENGTH ||
    !BASE64URL_PATTERN.test(raw)
  ) {
    throw new PublicCatalogRequestError("cursor")
  }

  let value: unknown
  try {
    value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
  } catch {
    throw new PublicCatalogRequestError("cursor")
  }

  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "v",
      "host",
      "filters",
      "featureBucket",
      "displayOrder",
      "createdAt",
      "id",
    ]) ||
    value.v !== 1 ||
    value.host !== hostname ||
    value.filters !== filterDigest(filters) ||
    (value.featureBucket !== 0 && value.featureBucket !== 1) ||
    typeof value.displayOrder !== "number" ||
    !Number.isSafeInteger(value.displayOrder) ||
    value.displayOrder < 0 ||
    value.displayOrder > MAX_DISPLAY_ORDER ||
    typeof value.createdAt !== "string" ||
    value.createdAt.length > 64 ||
    !RFC3339_PATTERN.test(value.createdAt) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id)
  ) {
    throw new PublicCatalogRequestError("cursor")
  }

  return value as CursorEnvelope
}

export function parsePublicCatalogRequest(
  searchParams: URLSearchParams,
  hostname: string,
): PublicCatalogRequest {
  const beneficiaryTypes = parseCommaList<BeneficiaryType>(
    searchParams.get("beneficiary_type"),
    BENEFICIARY_TYPE_SET,
    "beneficiary_type",
  )
  const statuses = parseCommaList<Status>(
    searchParams.get("status"),
    PUBLIC_FILTER_STATUS_SET,
    "status",
  )
  const ages = parseAgeRange(searchParams.get("ageRange"))
  const filters: PublicCatalogFilters = Object.freeze({
    beneficiaryTypes: Object.freeze(beneficiaryTypes),
    gender: parseGender(searchParams.get("gender")),
    statuses: Object.freeze(statuses),
    ...ages,
    search: parseSearch(searchParams.get("search")),
    limit: parseLimit(searchParams.get("limit")),
  })

  const rawCursor = searchParams.get("cursor")
  const envelope =
    rawCursor === null
      ? null
      : parseCursorEnvelope(rawCursor, hostname, filters)

  return {
    filters,
    cursor:
      envelope === null
        ? null
        : {
            featureBucket: envelope.featureBucket,
            displayOrder: envelope.displayOrder,
            createdAt: envelope.createdAt,
            id: envelope.id,
          },
  }
}

export function encodePublicCatalogCursor(
  hostname: string,
  filters: PublicCatalogFilters,
  components: PublicCatalogCursorComponents,
): string {
  const envelope: CursorEnvelope = {
    v: 1,
    host: hostname,
    filters: filterDigest(filters),
    featureBucket: components.featureBucket,
    displayOrder: components.displayOrder,
    createdAt: components.createdAt,
    id: components.id,
  }
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url")
}

function requiredString(
  source: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string {
  const value = source[key]
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !isWithinPublicBeneficiaryTextByteLimit(value, maximumLength) ||
    STRICT_CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new PublicCatalogShapeError(`item.${key}`)
  }
  return value
}

function nullableString(
  source: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string | null {
  const value = source[key]
  if (value === null) return null
  if (
    typeof value !== "string" ||
    !isWithinPublicBeneficiaryTextByteLimit(value, maximumLength) ||
    STRICT_CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new PublicCatalogShapeError(`item.${key}`)
  }
  return value
}

function nullableMultilineText(
  source: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string | null {
  const value = source[key]
  if (value === null) return null
  if (
    typeof value !== "string" ||
    !isWithinPublicBeneficiaryTextByteLimit(value, maximumLength) ||
    MULTILINE_TEXT_FORBIDDEN_CHARACTER_PATTERN.test(value)
  ) {
    throw new PublicCatalogShapeError(`item.${key}`)
  }
  return value
}

function finiteNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key]
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PublicCatalogShapeError(`item.${key}`)
  }
  return value
}

function parseBeneficiary(value: unknown): Beneficiaries {
  if (!isRecord(value)) throw new PublicCatalogShapeError("item")

  const id = requiredString(value, "id", 36)
  const status = requiredString(value, "status", 64)
  const username = requiredString(
    value,
    "username",
    MAX_BENEFICIARY_USERNAME_LENGTH,
  )
  const beneficiaryType = nullableString(value, "beneficiary_type", 64)
  const gender = nullableString(value, "gender", 16)
  if (
    !UUID_PATTERN.test(id) ||
    !RESPONSE_STATUS_SET.has(status) ||
    !isValidBeneficiaryUsername(username) ||
    (beneficiaryType !== null &&
      !DATABASE_BENEFICIARY_TYPE_PATTERN.test(beneficiaryType)) ||
    (gender !== null && gender !== "Boy" && gender !== "Girl")
  ) {
    throw new PublicCatalogShapeError("item.enum")
  }

  const birthDate = nullableString(value, "birth_date", 32)
  const metadata: BeneficiaryMetadata = isRecord(value.metadata)
    ? {
        birth_date_is_estimate: value.metadata.birth_date_is_estimate === true,
        birth_date_precision:
          value.metadata.birth_date_precision === "month"
            ? ("month" as const)
            : undefined,
      }
    : {}
  const locationGeo =
    isRecord(value.location_geo) &&
    value.location_geo.type === "Point" &&
    Array.isArray(value.location_geo.coordinates) &&
    value.location_geo.coordinates.length === 2 &&
    value.location_geo.coordinates.every(
      (coordinate) =>
        typeof coordinate === "number" && Number.isFinite(coordinate),
    )
      ? {
          type: "Point" as const,
          coordinates: value.location_geo.coordinates as [number, number],
        }
      : null

  return {
    id,
    created_at: nullableString(value, "created_at", 64) ?? undefined,
    name: requiredString(value, "name", 300),
    username,
    gender: gender as Gender,
    birth_date: birthDate ?? "",
    biography: nullableMultilineText(value, "biography", 100_000) ?? "",
    budget_goal: finiteNumber(value, "budget_goal"),
    budget_raised: finiteNumber(value, "budget_raised"),
    status: status as Status,
    country: nullableString(value, "country", 300) ?? "",
    location_geo: locationGeo,
    location_str: nullableString(value, "location_str", 1_000) ?? "",
    video_url: nullableString(value, "video_url", 4_096) ?? "",
    introduction: nullableMultilineText(value, "introduction", 100_000) ?? "",
    active_subscriptions: finiteNumber(value, "active_subscriptions"),
    metadata,
    beneficiary_type: beneficiaryType,
    sort_weight:
      value.sort_weight === null || value.sort_weight === undefined
        ? undefined
        : finiteNumber(value, "sort_weight"),
  }
}

function nullableTimestamp(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = nullableString(source, key, 64)
  if (
    value !== null &&
    (!RFC3339_PATTERN.test(value) || !Number.isFinite(Date.parse(value)))
  ) {
    throw new PublicCatalogShapeError(`item.${key}`)
  }
  return value
}

function parseMedia(
  value: unknown,
  expectedParentId: string,
): BeneficiaryMedia {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "id",
      "created_at",
      "extension",
      "parent_id",
      "type",
      "weight",
    ])
  ) {
    throw new PublicCatalogShapeError("media.item")
  }

  const id = requiredString(value, "id", 36)
  const parentId = requiredString(value, "parent_id", 36)
  const extension = requiredString(value, "extension", 32)
  const type = requiredString(value, "type", 16)
  const createdAt = nullableTimestamp(value, "created_at")
  const weight = value.weight
  if (
    !UUID_PATTERN.test(id) ||
    parentId !== expectedParentId ||
    !UUID_PATTERN.test(parentId) ||
    !/^[A-Za-z0-9]{1,32}$/.test(extension) ||
    !MEDIA_TYPE_SET.has(type) ||
    (weight !== null &&
      (typeof weight !== "number" ||
        !Number.isSafeInteger(weight) ||
        weight < -2_147_483_648 ||
        weight > MAX_DISPLAY_ORDER))
  ) {
    throw new PublicCatalogShapeError("media.item.value")
  }

  return {
    id,
    parent_id: parentId,
    extension,
    type: type as BeneficiaryMedia["type"],
    weight: weight as number | null,
    created_at: createdAt,
  }
}

function parseMediaArray(
  value: unknown,
  expectedParentId: string,
  maximumItems: number,
  stage: string,
): BeneficiaryMedia[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new PublicCatalogShapeError(stage)
  }
  const result = value.map((item) => parseMedia(item, expectedParentId))
  if (new Set(result.map((item) => item.id)).size !== result.length) {
    throw new PublicCatalogShapeError(`${stage}.duplicate`)
  }
  return result
}

function parseActivity(
  value: unknown,
  expectedBeneficiaryId: string,
): PublicCatalogActivity {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "id",
      "created_at",
      "description",
      "beneficiary_id",
      "title",
      "activity_type",
      "media",
    ])
  ) {
    throw new PublicCatalogShapeError("activities.item")
  }

  const id = requiredString(value, "id", 36)
  const beneficiaryId = requiredString(value, "beneficiary_id", 36)
  const createdAt = nullableTimestamp(value, "created_at")
  const activityType = value.activity_type
  if (
    !UUID_PATTERN.test(id) ||
    beneficiaryId !== expectedBeneficiaryId ||
    !UUID_PATTERN.test(beneficiaryId) ||
    createdAt === null ||
    (activityType !== null &&
      (typeof activityType !== "string" ||
        !ACTIVITY_TYPE_SET.has(activityType)))
  ) {
    throw new PublicCatalogShapeError("activities.item.value")
  }

  return {
    id,
    created_at: createdAt,
    description: nullableMultilineText(value, "description", 100_000),
    beneficiary_id: beneficiaryId,
    title: nullableMultilineText(value, "title", 10_000),
    activity_type: activityType as PublicCatalogActivity["activity_type"],
    media: parseMediaArray(
      value.media,
      id,
      MAX_ACTIVITY_MEDIA_ITEMS,
      "activities.item.media",
    ),
  }
}

export function parsePublicBeneficiary(source: unknown): Beneficiaries | null {
  if (source === null) return null
  return parseBeneficiary(source)
}

export function parsePublicBeneficiaryMedia(
  source: unknown,
  expectedBeneficiaryId: string,
): BeneficiaryMedia[] | null {
  if (source === null) return null
  if (
    !isRecord(source) ||
    !exactKeys(source, ["items", "hasMore"]) ||
    source.hasMore !== false
  ) {
    throw new PublicCatalogShapeError("media")
  }

  return parseMediaArray(
    source.items,
    expectedBeneficiaryId,
    MAX_MEDIA_ITEMS,
    "media.items",
  )
}

export function parsePublicBeneficiaryActivities(
  source: unknown,
  expectedBeneficiaryId: string,
): PublicCatalogActivity[] | null {
  if (source === null) return null
  if (
    !isRecord(source) ||
    !exactKeys(source, ["items", "hasMore"]) ||
    source.hasMore !== false ||
    !Array.isArray(source.items) ||
    source.items.length > MAX_ACTIVITY_ITEMS
  ) {
    throw new PublicCatalogShapeError("activities")
  }

  let totalActivityMediaItems = 0
  for (const activity of source.items) {
    if (isRecord(activity) && Array.isArray(activity.media)) {
      totalActivityMediaItems += activity.media.length
      if (totalActivityMediaItems > MAX_TOTAL_ACTIVITY_MEDIA_ITEMS) {
        throw new PublicCatalogShapeError("activities.media.total")
      }
    }
  }

  const activities = source.items.map((activity) =>
    parseActivity(activity, expectedBeneficiaryId),
  )
  if (
    new Set(activities.map((activity) => activity.id)).size !==
    activities.length
  ) {
    throw new PublicCatalogShapeError("activities.duplicate")
  }
  return activities
}

function parseCursorComponents(
  value: unknown,
): PublicCatalogCursorComponents | null {
  if (value === null) return null
  if (
    !isRecord(value) ||
    !exactKeys(value, ["featureBucket", "displayOrder", "createdAt", "id"]) ||
    (value.featureBucket !== 0 && value.featureBucket !== 1) ||
    typeof value.displayOrder !== "number" ||
    !Number.isSafeInteger(value.displayOrder) ||
    value.displayOrder < 0 ||
    value.displayOrder > MAX_DISPLAY_ORDER ||
    typeof value.createdAt !== "string" ||
    value.createdAt.length > 64 ||
    !RFC3339_PATTERN.test(value.createdAt) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id)
  ) {
    throw new PublicCatalogShapeError("nextCursor")
  }
  return value as unknown as PublicCatalogCursorComponents
}

export function parsePublicCatalogPage(
  source: unknown,
  hostname: string,
  filters: PublicCatalogFilters,
): PublicCatalogPage | null {
  if (source === null) return null
  if (
    !isRecord(source) ||
    !exactKeys(source, ["items", "totalCount", "pageInfo"]) ||
    !Array.isArray(source.items) ||
    source.items.length > filters.limit ||
    typeof source.totalCount !== "number" ||
    !Number.isSafeInteger(source.totalCount) ||
    source.totalCount < 0 ||
    !isRecord(source.pageInfo) ||
    !exactKeys(source.pageInfo, ["limit", "hasMore", "nextCursor"]) ||
    source.pageInfo.limit !== filters.limit ||
    typeof source.pageInfo.hasMore !== "boolean"
  ) {
    throw new PublicCatalogShapeError("page")
  }

  const people = source.items.map(parseBeneficiary)
  const nextComponents = parseCursorComponents(source.pageInfo.nextCursor)
  if (
    (source.pageInfo.hasMore &&
      (people.length === 0 || nextComponents === null)) ||
    (!source.pageInfo.hasMore && nextComponents !== null)
  ) {
    throw new PublicCatalogShapeError("pagination")
  }

  return {
    people,
    totalCount: source.totalCount,
    pageInfo: {
      limit: filters.limit,
      hasMore: source.pageInfo.hasMore,
      nextCursor:
        nextComponents === null
          ? null
          : encodePublicCatalogCursor(hostname, filters, nextComponents),
    },
  }
}
