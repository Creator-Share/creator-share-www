import "server-only"

import {
  resolvePublicAdvocateRequest,
  type PublicAdvocatePresentationRepository,
} from "./publicPresentation"
import { isReservedNonPrimaryHostname } from "./host"
import {
  createAdvocatePublicSite,
  createPrimaryPublicSite,
  type PublicSite,
} from "./publicSite"

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const MAX_CONFIGURED_URL_LENGTH = 2_048

export type PublicSiteRequestEnvironment = Readonly<
  Record<string, string | undefined>
>

export type PublicSiteRequestResolution =
  | {
      kind: "ready"
      site: PublicSite
    }
  | {
      kind: "not-found"
      reason: "rejected-host" | "unavailable-tenant"
      hostname: string | null
    }
  | {
      kind: "operational-failure"
      hostname: string
      error: unknown
    }

function hostnameFromConfiguredUrl(value: string | undefined): string | null {
  if (
    !value ||
    value.length > MAX_CONFIGURED_URL_LENGTH ||
    value !== value.trim() ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return null
  }

  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`)
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null
    }

    const lower = url.hostname.toLowerCase()
    return lower.endsWith(".") ? lower.slice(0, -1) : lower
  } catch {
    return null
  }
}

export function configuredPrimaryHostnames(
  environment: PublicSiteRequestEnvironment,
): readonly string[] {
  return Object.freeze(
    [
      hostnameFromConfiguredUrl(environment.NEXT_PUBLIC_BASE_URL),
      hostnameFromConfiguredUrl(environment.NEXT_PUBLIC_SITE_URL),
      hostnameFromConfiguredUrl(environment.VERCEL_URL),
    ].filter(
      (hostname): hostname is string =>
        hostname !== null && !isReservedNonPrimaryHostname(hostname),
    ),
  )
}

/**
 * Resolves the exact HTTP Host header through the active advocate presentation
 * boundary. Forwarded host headers are deliberately excluded because they are
 * meaningful only after a separately verified proxy trust configuration.
 */
export async function resolvePublicSiteRequest(options: {
  rawHost: string | null | undefined
  repository: PublicAdvocatePresentationRepository
  environment?: PublicSiteRequestEnvironment
}): Promise<PublicSiteRequestResolution> {
  const environment = options.environment ?? process.env
  const allowLocalhostDevelopment = environment.NODE_ENV !== "production"
  const resolution = await resolvePublicAdvocateRequest(
    options.rawHost,
    options.repository,
    {
      allowLocalhostDevelopment,
      allowInsecureLocalLogoOrigin: allowLocalhostDevelopment,
      logoPublicOrigin: environment.NEXT_PUBLIC_SUPABASE_URL ?? null,
      approvedPrimaryHostnames: configuredPrimaryHostnames(environment),
    },
  )

  switch (resolution.kind) {
    case "primary":
      return {
        kind: "ready",
        site: createPrimaryPublicSite(resolution.hostname),
      }
    case "active-advocate":
      return {
        kind: "ready",
        site: createAdvocatePublicSite(resolution.presentation),
      }
    case "unavailable-tenant":
      return {
        kind: "not-found",
        reason: "unavailable-tenant",
        hostname: resolution.canonicalHostname,
      }
    case "rejected-host":
      return {
        kind: "not-found",
        reason: "rejected-host",
        hostname: resolution.hostname,
      }
    case "operational-failure":
      return {
        kind: "operational-failure",
        hostname: resolution.canonicalHostname,
        error: resolution.error,
      }
  }
}
