import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { exactAdvocateLogoStoragePath } from "@/lib/advocates/admin/branding"
import type {
  AdvocateBeneficiaryMode,
  AdvocatePortalAccess,
  AdvocatePublicationStatus,
  AdvocateRelationshipStatus,
} from "@/lib/advocates/admin/access"
import { PUBLIC_ADVOCATE_METRIC_KEYS } from "@/lib/advocates/publicPresentation"
import {
  sanitizeAdvocateAboutBiographyRichText,
  sanitizeAdvocateOpeningHeaderRichText,
} from "@/lib/advocates/richText"
import { normalizePublicSiteColor } from "@/lib/advocates/publicSiteTheme"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const RELATIONSHIP_STATUSES = new Set<AdvocateRelationshipStatus>([
  "invited",
  "active",
  "suspended",
  "archived",
])
const PUBLICATION_STATUSES = new Set<AdvocatePublicationStatus>([
  "draft",
  "provisioning",
  "active",
  "failed",
  "suspended",
])
const BENEFICIARY_MODES = new Set<AdvocateBeneficiaryMode>([
  "all",
  "all_featured",
  "selected",
])
const PUBLIC_METRICS = new Set<string>(PUBLIC_ADVOCATE_METRIC_KEYS)

export interface AdvocateAdminBranding {
  primaryColor: string
  accentColor: string
  logoStoragePath: string | null
  logoAltText: string | null
  openingHeaderHtml: string
  aboutBiographyHtml: string
}

export interface AdvocateAdminSettings {
  advocate: {
    id: string
    slug: string
    displayName: string
    advocateType: string
    relationshipStatus: AdvocateRelationshipStatus
    publicationStatus: AdvocatePublicationStatus
    beneficiaryMode: AdvocateBeneficiaryMode
    advocateVersion: number
  }
  branding: AdvocateAdminBranding
  publicMetricSelections: readonly {
    metricKey: (typeof PUBLIC_ADVOCATE_METRIC_KEYS)[number]
    displayOrder: number
  }[]
  beneficiarySelections: readonly {
    beneficiaryId: string
    isFeatured: boolean
    displayOrder: number
  }[]
}

type SupabaseErrorLike = Readonly<{ code?: string }> | null

export class AdvocateAdminSettingsRepositoryError extends Error {
  readonly stage: "settings_query" | "settings_shape"

  constructor(
    stage: "settings_query" | "settings_shape",
    cause: SupabaseErrorLike = null,
  ) {
    super("advocate_admin_settings_unavailable", { cause })
    this.name = "AdvocateAdminSettingsRepositoryError"
    this.stage = stage
  }
}

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

function boundedTrimmedText(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  )
}

function optionalBoundedText(
  value: unknown,
  maximumLength: number,
): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length >= 1 &&
      value.length <= maximumLength &&
      value === value.trim() &&
      !CONTROL_CHARACTER_PATTERN.test(value))
  )
}

function parseBranding(
  value: unknown,
  slug: string,
): AdvocateAdminBranding | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "primary_color",
      "accent_color",
      "logo_storage_path",
      "logo_alt_text",
      "opening_header_html",
      "about_biography_html",
    ])
  ) {
    return null
  }

  const primaryColor = normalizePublicSiteColor(value.primary_color)
  const accentColor = normalizePublicSiteColor(value.accent_color)
  const logoStoragePath = exactAdvocateLogoStoragePath(
    value.logo_storage_path,
    slug,
  )
  if (
    primaryColor === null ||
    accentColor === null ||
    logoStoragePath === undefined ||
    !optionalBoundedText(value.logo_alt_text, 300) ||
    (logoStoragePath === null && value.logo_alt_text !== null)
  ) {
    return null
  }

  try {
    return {
      primaryColor,
      accentColor,
      logoStoragePath,
      logoAltText: value.logo_alt_text,
      openingHeaderHtml: sanitizeAdvocateOpeningHeaderRichText(
        value.opening_header_html,
      ),
      aboutBiographyHtml: sanitizeAdvocateAboutBiographyRichText(
        value.about_biography_html,
      ),
    }
  } catch {
    return null
  }
}

function parseMetricSelections(value: unknown) {
  if (!Array.isArray(value) || value.length > PUBLIC_METRICS.size) return null
  const seen = new Set<string>()
  const selections: AdvocateAdminSettings["publicMetricSelections"][number][] =
    []
  for (const [index, candidate] of value.entries()) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ["metric_key", "display_order"]) ||
      typeof candidate.metric_key !== "string" ||
      !PUBLIC_METRICS.has(candidate.metric_key) ||
      seen.has(candidate.metric_key) ||
      candidate.display_order !== index
    ) {
      return null
    }
    seen.add(candidate.metric_key)
    selections.push({
      metricKey:
        candidate.metric_key as AdvocateAdminSettings["publicMetricSelections"][number]["metricKey"],
      displayOrder: index,
    })
  }
  return Object.freeze(selections)
}

function parseBeneficiarySelections(value: unknown) {
  if (!Array.isArray(value) || value.length > 1_000) return null
  const seen = new Set<string>()
  const selections: AdvocateAdminSettings["beneficiarySelections"][number][] =
    []
  for (const [index, candidate] of value.entries()) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, [
        "beneficiary_id",
        "is_featured",
        "display_order",
      ]) ||
      typeof candidate.beneficiary_id !== "string" ||
      !UUID_PATTERN.test(candidate.beneficiary_id) ||
      seen.has(candidate.beneficiary_id) ||
      typeof candidate.is_featured !== "boolean" ||
      candidate.display_order !== index
    ) {
      return null
    }
    seen.add(candidate.beneficiary_id)
    selections.push({
      beneficiaryId: candidate.beneficiary_id,
      isFeatured: candidate.is_featured,
      displayOrder: index,
    })
  }
  return Object.freeze(selections)
}

export function parseAdvocateAdminSettings(
  value: unknown,
  expected: Pick<AdvocatePortalAccess, "advocateId" | "slug">,
): AdvocateAdminSettings | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "advocate",
      "branding",
      "public_metric_selections",
      "beneficiary_selections",
    ]) ||
    !isRecord(value.advocate) ||
    !hasExactKeys(value.advocate, [
      "id",
      "slug",
      "display_name",
      "advocate_type",
      "relationship_status",
      "publication_status",
      "beneficiary_mode",
      "advocate_version",
    ])
  ) {
    return null
  }

  const advocate = value.advocate
  const branding = parseBranding(value.branding, expected.slug)
  const publicMetricSelections = parseMetricSelections(
    value.public_metric_selections,
  )
  const beneficiarySelections = parseBeneficiarySelections(
    value.beneficiary_selections,
  )
  if (
    advocate.id !== expected.advocateId ||
    advocate.slug !== expected.slug ||
    !boundedTrimmedText(advocate.display_name, 160) ||
    !boundedTrimmedText(advocate.advocate_type, 64) ||
    typeof advocate.relationship_status !== "string" ||
    !RELATIONSHIP_STATUSES.has(
      advocate.relationship_status as AdvocateRelationshipStatus,
    ) ||
    typeof advocate.publication_status !== "string" ||
    !PUBLICATION_STATUSES.has(
      advocate.publication_status as AdvocatePublicationStatus,
    ) ||
    typeof advocate.beneficiary_mode !== "string" ||
    !BENEFICIARY_MODES.has(
      advocate.beneficiary_mode as AdvocateBeneficiaryMode,
    ) ||
    typeof advocate.advocate_version !== "number" ||
    !Number.isSafeInteger(advocate.advocate_version) ||
    advocate.advocate_version < 1 ||
    branding === null ||
    publicMetricSelections === null ||
    beneficiarySelections === null
  ) {
    return null
  }

  return Object.freeze({
    advocate: Object.freeze({
      id: advocate.id,
      slug: advocate.slug,
      displayName: advocate.display_name,
      advocateType: advocate.advocate_type,
      relationshipStatus:
        advocate.relationship_status as AdvocateRelationshipStatus,
      publicationStatus:
        advocate.publication_status as AdvocatePublicationStatus,
      beneficiaryMode: advocate.beneficiary_mode as AdvocateBeneficiaryMode,
      advocateVersion: advocate.advocate_version,
    }),
    branding: Object.freeze(branding),
    publicMetricSelections,
    beneficiarySelections,
  })
}

export function createAdvocateAdminSettingsRepository(client: SupabaseClient) {
  return {
    async load(portal: Pick<AdvocatePortalAccess, "advocateId" | "slug">) {
      const { data, error } = await client.rpc("get_advocate_admin_settings", {
        target_advocate_id: portal.advocateId,
      })
      if (error) {
        throw new AdvocateAdminSettingsRepositoryError("settings_query", error)
      }
      const settings = parseAdvocateAdminSettings(data, portal)
      if (settings === null) {
        throw new AdvocateAdminSettingsRepositoryError("settings_shape")
      }
      return settings
    },
  }
}
