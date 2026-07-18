import "server-only"

import { resolveAdvocateHost } from "@/lib/advocates/host"

export type CheckoutRequestEnvironment = Readonly<
  Record<string, string | undefined>
>

function hostnameFromConfiguredUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`)
    return url.hostname.toLowerCase()
  } catch {
    return null
  }
}

function configuredPrimaryHostnames(
  environment: CheckoutRequestEnvironment,
): Set<string> {
  return new Set(
    [
      "creatorshare.com",
      "www.creatorshare.com",
      "creator-share-www.vercel.app",
      hostnameFromConfiguredUrl(environment.NEXT_PUBLIC_BASE_URL),
      hostnameFromConfiguredUrl(environment.NEXT_PUBLIC_SITE_URL),
      hostnameFromConfiguredUrl(environment.VERCEL_URL),
    ].filter((value): value is string => Boolean(value)),
  )
}

function primaryOrigin(options: {
  rawHost: string | null
  environment: CheckoutRequestEnvironment
}): string | null {
  const allowLocalhostDevelopment =
    options.environment.NODE_ENV !== "production"
  const resolution = resolveAdvocateHost(options.rawHost, {
    allowLocalhostDevelopment,
  })
  if (resolution.kind !== "non-tenant") return null

  const hostname = resolution.normalizedHostname
  const isLocal =
    resolution.reason === "localhost-root" ||
    resolution.reason === "loopback-address"
  if (
    !configuredPrimaryHostnames(options.environment).has(hostname) &&
    !(allowLocalhostDevelopment && isLocal)
  ) {
    return null
  }

  const protocol = allowLocalhostDevelopment && isLocal ? "http" : "https"
  const port = resolution.port === null ? "" : `:${resolution.port}`
  return `${protocol}://${hostname}${port}`
}

/** Resolves only an approved Creator Share primary or local development origin. */
export function resolveTrustedPrimaryRequestOrigin(options: {
  rawHost: string | null
  environment?: CheckoutRequestEnvironment
}): string | null {
  return primaryOrigin({
    rawHost: options.rawHost,
    environment: options.environment ?? process.env,
  })
}

/**
 * Resolves only a Creator Share primary origin or a syntactically valid
 * Creator Share tenant origin. The database still authorizes tenant activity;
 * this function supplies an exact same-origin boundary before body parsing.
 */
export function resolveTrustedCheckoutRequestOrigin(options: {
  rawHost: string | null
  environment?: CheckoutRequestEnvironment
}): string | null {
  const environment = options.environment ?? process.env
  const allowLocalhostDevelopment = environment.NODE_ENV !== "production"
  const resolution = resolveAdvocateHost(options.rawHost, {
    allowLocalhostDevelopment,
  })
  if (resolution.kind === "invalid") return null

  if (resolution.kind === "tenant-candidate") {
    const protocol =
      resolution.environment === "local-development" ? "http" : "https"
    const port =
      resolution.requestPort === null ? "" : `:${resolution.requestPort}`
    return `${protocol}://${resolution.requestHostname}${port}`
  }
  return primaryOrigin({ rawHost: options.rawHost, environment })
}

export function isTrustedCheckoutJsonRequest(
  headers: Pick<Headers, "get">,
  expectedOrigin: string,
): boolean {
  const origin = headers.get("origin")
  const fetchSite = headers.get("sec-fetch-site")
  const contentType = headers.get("content-type")

  return (
    origin === expectedOrigin &&
    (fetchSite === null || fetchSite === "same-origin") &&
    contentType !== null &&
    /^application\/json(?:\s*;|$)/i.test(contentType)
  )
}
