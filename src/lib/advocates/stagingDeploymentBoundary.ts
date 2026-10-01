import { isAdvocateStagingEnvironmentEnabled } from "./host"

export const ADVOCATE_STAGING_SUPABASE_PROJECT_REF =
  "destjwstohzmufshfnuy" as const
export const ADVOCATE_STAGING_SUPABASE_ORIGIN =
  `https://${ADVOCATE_STAGING_SUPABASE_PROJECT_REF}.supabase.co` as const

const BASE64URL_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/
const SUPABASE_PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]{20,}$/
const SUPABASE_SECRET_KEY_PATTERN = /^sb_secret_[A-Za-z0-9_-]{20,}$/

export type AdvocateStagingDeploymentEnvironment = Readonly<
  Record<string, string | undefined>
>

export interface AdvocateStagingSupabaseBoundaryOptions {
  requireServiceRole?: boolean
}

const DISABLED_STAGING_EXTERNAL_PROVIDER_VARIABLES = Object.freeze([
  "LLM_API_KEY",
  "LLM_API_HOST",
  "NEXT_PUBLIC_MAPTILER_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "TELEGRAM_MANAGER_CHAT_ID",
] as const)

type SupabaseLegacyKeyClaims = {
  ref: string
  role: "anon" | "service_role"
}

function decodeBase64UrlUtf8(value: string): string | null {
  if (!value || !BASE64URL_SEGMENT_PATTERN.test(value)) return null

  try {
    const standardBase64 = value.replaceAll("-", "+").replaceAll("_", "/")
    const paddingLength = (4 - (standardBase64.length % 4)) % 4
    const bytes = Uint8Array.from(
      atob(`${standardBase64}${"=".repeat(paddingLength)}`),
      (character) => character.charCodeAt(0),
    )
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function legacySupabaseKeyClaims(
  value: string,
): SupabaseLegacyKeyClaims | null {
  const segments = value.split(".")
  if (
    segments.length !== 3 ||
    segments.some(
      (segment) => !segment || !BASE64URL_SEGMENT_PATTERN.test(segment),
    )
  ) {
    return null
  }

  const payload = decodeBase64UrlUtf8(segments[1])
  if (payload === null) return null

  try {
    const decoded: unknown = JSON.parse(payload)
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      Array.isArray(decoded)
    ) {
      return null
    }

    const { ref, role } = decoded as Record<string, unknown>
    if (
      ref !== ADVOCATE_STAGING_SUPABASE_PROJECT_REF ||
      (role !== "anon" && role !== "service_role")
    ) {
      return null
    }
    return { ref, role }
  } catch {
    return null
  }
}

function stagingSupabaseKeyHasRole(
  value: string | undefined,
  expectedRole: "anon" | "service_role",
): boolean {
  if (!value || value !== value.trim()) return false

  if (expectedRole === "anon" && SUPABASE_PUBLISHABLE_KEY_PATTERN.test(value)) {
    return true
  }
  if (
    expectedRole === "service_role" &&
    SUPABASE_SECRET_KEY_PATTERN.test(value)
  ) {
    return true
  }
  return legacySupabaseKeyClaims(value)?.role === expectedRole
}

/**
 * The advocate staging host is a fixed infrastructure boundary, not a
 * general-purpose preview mode. Fail before creating a Supabase client if a
 * copied deployment environment could connect staging code to another
 * project, especially production.
 */
export function assertAdvocateStagingSupabaseBoundary(
  environment: AdvocateStagingDeploymentEnvironment = process.env,
  options: AdvocateStagingSupabaseBoundaryOptions = {},
): void {
  if (!isAdvocateStagingEnvironmentEnabled(environment)) return

  if (
    environment.NEXT_PUBLIC_SUPABASE_URL !== ADVOCATE_STAGING_SUPABASE_ORIGIN ||
    !stagingSupabaseKeyHasRole(
      environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      "anon",
    ) ||
    ((options.requireServiceRole ?? true) &&
      !stagingSupabaseKeyHasRole(
        environment.NEXT_SERVICE_ROLE_KEY,
        "service_role",
      ))
  ) {
    throw new Error("advocate_staging_supabase_configuration_invalid")
  }
}

export function assertAdvocateStagingExternalProviderBoundary(
  environment: AdvocateStagingDeploymentEnvironment = process.env,
): void {
  if (!isAdvocateStagingEnvironmentEnabled(environment)) return

  if (
    DISABLED_STAGING_EXTERNAL_PROVIDER_VARIABLES.some((name) =>
      Boolean(environment[name]?.trim()),
    )
  ) {
    throw new Error("advocate_staging_external_provider_configuration_invalid")
  }
}
