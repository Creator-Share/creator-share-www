export const MAX_ADVOCATE_BRANDING_RICH_TEXT_BYTES = 16_384
export const MAX_ADVOCATE_BRANDING_LOGO_BYTES = 5 * 1024 * 1024

const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ACCEPTED_LOGO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

export interface AdvocateBrandingFormValues {
  expectedVersion: number
  primaryColor: string
  accentColor: string
  logoStoragePath: string | null
  logoAltText: string | null
  openingHeaderHtml: string
  aboutBiographyHtml: string
  changeReason: string
}

export type AdvocateBrandingSaveResult =
  | { ok: true; advocateVersion: number; requestId: string }
  | { ok: false; code: string; requestId: string | null }

export interface AdvocateBrandingEditability {
  canEdit: boolean
  readOnlyReason: string | null
}

export function resolveAdvocateBrandingEditability(input: {
  hasBrandingPermission: boolean
  relationshipStatus: "invited" | "active" | "suspended" | "archived"
  publicationStatus:
    "draft" | "provisioning" | "active" | "failed" | "suspended"
}): AdvocateBrandingEditability {
  if (input.relationshipStatus === "invited") {
    return {
      canEdit: false,
      readOnlyReason:
        "Branding is read only until this advocate invitation is accepted and access becomes active.",
    }
  }
  if (input.relationshipStatus === "suspended") {
    return {
      canEdit: false,
      readOnlyReason:
        "This advocate relationship is suspended, so branding is read only.",
    }
  }
  if (input.relationshipStatus === "archived") {
    return {
      canEdit: false,
      readOnlyReason:
        "This advocate relationship is archived, so branding is read only.",
    }
  }
  if (input.publicationStatus === "suspended") {
    return {
      canEdit: false,
      readOnlyReason: "This portal is suspended, so branding is read only.",
    }
  }
  if (!input.hasBrandingPermission) {
    return {
      canEdit: false,
      readOnlyReason:
        "You have view access. A portal administrator with branding permission must make changes.",
    }
  }
  return { canEdit: true, readOnlyReason: null }
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

export function normalizeAdvocateBrandingFormColor(
  value: string,
): string | null {
  const normalized = value.trim().toUpperCase()
  return HEX_COLOR_PATTERN.test(normalized) ? normalized : null
}

export function isAdvocateBrandingRichTextWithinLimit(value: string): boolean {
  return (
    typeof value === "string" &&
    new TextEncoder().encode(value).byteLength <=
      MAX_ADVOCATE_BRANDING_RICH_TEXT_BYTES
  )
}

export function validateAdvocateBrandingLogoFile(
  file: Pick<File, "size" | "type">,
): "logo_empty" | "logo_too_large" | "logo_type" | null {
  if (!Number.isSafeInteger(file.size) || file.size < 1) return "logo_empty"
  if (file.size > MAX_ADVOCATE_BRANDING_LOGO_BYTES) return "logo_too_large"
  return ACCEPTED_LOGO_TYPES.has(file.type.toLowerCase()) ? null : "logo_type"
}

export function buildAdvocateBrandingJsonPayload(
  values: AdvocateBrandingFormValues,
): AdvocateBrandingFormValues {
  return {
    expectedVersion: values.expectedVersion,
    primaryColor: values.primaryColor,
    accentColor: values.accentColor,
    logoStoragePath: values.logoStoragePath,
    logoAltText: values.logoAltText,
    openingHeaderHtml: values.openingHeaderHtml,
    aboutBiographyHtml: values.aboutBiographyHtml,
    changeReason: values.changeReason,
  }
}

export function buildAdvocateBrandingLogoFormData(input: {
  file: File
  values: Omit<AdvocateBrandingFormValues, "logoStoragePath">
}): FormData {
  const form = new FormData()
  form.set("file", input.file)
  form.set("expectedVersion", String(input.values.expectedVersion))
  form.set("primaryColor", input.values.primaryColor)
  form.set("accentColor", input.values.accentColor)
  form.set("logoAltText", input.values.logoAltText ?? "")
  form.set("openingHeaderHtml", input.values.openingHeaderHtml)
  form.set("aboutBiographyHtml", input.values.aboutBiographyHtml)
  form.set("changeReason", input.values.changeReason)
  return form
}

export function parseAdvocateBrandingSaveResponse(
  value: unknown,
  expectedVersion: number,
): AdvocateBrandingSaveResult | null {
  if (!isRecord(value)) return null

  if (
    value.ok === true &&
    hasExactKeys(value, ["ok", "requestId", "advocateVersion"]) &&
    typeof value.requestId === "string" &&
    UUID_PATTERN.test(value.requestId) &&
    typeof value.advocateVersion === "number" &&
    Number.isSafeInteger(value.advocateVersion) &&
    value.advocateVersion === expectedVersion + 1
  ) {
    return {
      ok: true,
      advocateVersion: value.advocateVersion,
      requestId: value.requestId,
    }
  }

  if (
    value.ok === false &&
    hasExactKeys(value, ["ok", "requestId", "code"]) &&
    typeof value.code === "string" &&
    value.code.length >= 1 &&
    value.code.length <= 64 &&
    typeof value.requestId === "string" &&
    UUID_PATTERN.test(value.requestId)
  ) {
    return { ok: false, code: value.code, requestId: value.requestId }
  }

  return null
}

export function advocateBrandingFormFingerprint(
  values: Omit<AdvocateBrandingFormValues, "expectedVersion" | "changeReason">,
): string {
  return JSON.stringify(values)
}
