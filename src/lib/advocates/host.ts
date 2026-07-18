export const ADVOCATE_TENANT_ROOT = "creatorshare.com"
export const ADVOCATE_LOCALHOST_ROOT = "localhost"

/**
 * These labels are platform infrastructure or product surfaces, not advocate
 * tenants. Slug provisioning must enforce the same list. Host resolution keeps
 * the list here as a defense-in-depth check before any database lookup.
 */
export const RESERVED_ADVOCATE_SUBDOMAINS = [
  "abuse",
  "acme",
  "account",
  "accounts",
  "admin",
  "advocate",
  "advocates",
  "alpha",
  "analytics",
  "api",
  "app",
  "assets",
  "auth",
  "autodiscover",
  "beta",
  "billing",
  "blog",
  "campaign",
  "campaigns",
  "careers",
  "cdn",
  "checkout",
  "cloudflare",
  "creator",
  "creator-share",
  "creators",
  "creatorshare",
  "dashboard",
  "demo",
  "dev",
  "development",
  "dns",
  "docs",
  "donate",
  "donations",
  "email",
  "events",
  "files",
  "ftp",
  "git",
  "github",
  "help",
  "hooks",
  "images",
  "imap",
  "internal",
  "jobs",
  "legal",
  "local",
  "localhost",
  "login",
  "logs",
  "mail",
  "media",
  "metrics",
  "monitor",
  "monitoring",
  "mta-sts",
  "news",
  "ns1",
  "ns2",
  "partner",
  "partners",
  "pay",
  "payments",
  "paypal",
  "pop",
  "portal",
  "portals",
  "postmaster",
  "press",
  "preview",
  "privacy",
  "qa",
  "register",
  "sandbox",
  "security",
  "share-tanzania",
  "sharetanzania",
  "sftp",
  "signup",
  "smtp",
  "ssh",
  "stage",
  "staging",
  "static",
  "status",
  "storage",
  "stripe",
  "subscriptions",
  "supabase",
  "support",
  "tanzania",
  "terms",
  "test",
  "testing",
  "vercel",
  "vpn",
  "webhooks",
  "www",
] as const

const RESERVED_SUBDOMAIN_SET = new Set<string>(RESERVED_ADVOCATE_SUBDOMAINS)

const MAX_HOSTNAME_LENGTH = 253
const HOSTNAME_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

export type InvalidAdvocateHostReason =
  | "missing-host"
  | "invalid-whitespace"
  | "invalid-syntax"
  | "invalid-hostname"
  | "invalid-port"
  | "port-not-allowed"

export type NonTenantAdvocateHostReason =
  | "tenant-root"
  | "reserved-subdomain"
  | "nested-subdomain"
  | "outside-tenant-root"
  | "local-development-disabled"
  | "localhost-root"
  | "loopback-address"

export interface ActiveAdvocateDomainLookup {
  hostname: string
  requiredStatus: "active"
}

export type AdvocateHostResolution =
  | {
      kind: "invalid"
      reason: InvalidAdvocateHostReason
    }
  | {
      kind: "non-tenant"
      reason: NonTenantAdvocateHostReason
      normalizedHostname: string
      port: number | null
    }
  | {
      kind: "tenant-candidate"
      environment: "production" | "local-development"
      requestHostname: string
      requestPort: number | null
      tenantLabel: string
      domainLookup: ActiveAdvocateDomainLookup
    }

export interface ResolveAdvocateHostOptions {
  /**
   * Local tenant hosts are denied by default. Callers must opt in based on a
   * trusted runtime condition, such as NODE_ENV, never from request input.
   */
  allowLocalhostDevelopment?: boolean
}

type ParsedHost = {
  hostname: string
  port: number | null
  loopback: boolean
}

function invalid(reason: InvalidAdvocateHostReason): AdvocateHostResolution {
  return { kind: "invalid", reason }
}

function parsePort(rawPort: string): number | null {
  if (!/^[1-9][0-9]{0,4}$/.test(rawPort)) return null

  const port = Number(rawPort)
  return port <= 65535 ? port : null
}

function hasValidHostnameSyntax(hostname: string): boolean {
  if (!hostname || hostname.length > MAX_HOSTNAME_LENGTH) return false

  return hostname
    .split(".")
    .every((label) => HOSTNAME_LABEL_PATTERN.test(label))
}

function parseHostHeader(
  rawHost: string | null | undefined,
): ParsedHost | AdvocateHostResolution {
  if (!rawHost) return invalid("missing-host")
  if (/\s/.test(rawHost)) return invalid("invalid-whitespace")

  const ipv6LoopbackMatch = /^\[::1\](?::([0-9]+))?$/i.exec(rawHost)
  if (ipv6LoopbackMatch) {
    const rawPort = ipv6LoopbackMatch[1]
    const port = rawPort === undefined ? null : parsePort(rawPort)
    if (rawPort !== undefined && port === null) return invalid("invalid-port")

    return { hostname: "[::1]", port, loopback: true }
  }

  if (!/^[a-z0-9.-]+(?::[0-9]+)?$/i.test(rawHost)) {
    return invalid("invalid-syntax")
  }

  const colonIndex = rawHost.lastIndexOf(":")
  const hasPort = colonIndex !== -1
  const rawHostname = hasPort ? rawHost.slice(0, colonIndex) : rawHost
  const rawPort = hasPort ? rawHost.slice(colonIndex + 1) : null
  const port = rawPort === null ? null : parsePort(rawPort)

  if (rawPort !== null && port === null) return invalid("invalid-port")

  const lowerHostname = rawHostname.toLowerCase()
  const hostname = lowerHostname.endsWith(".")
    ? lowerHostname.slice(0, -1)
    : lowerHostname

  if (!hasValidHostnameSyntax(hostname)) return invalid("invalid-hostname")

  const loopback = hostname === "127.0.0.1"
  const localhost =
    hostname === ADVOCATE_LOCALHOST_ROOT ||
    hostname.endsWith(`.${ADVOCATE_LOCALHOST_ROOT}`)

  if (port !== null && !localhost && !loopback) {
    return invalid("port-not-allowed")
  }

  return { hostname, port, loopback }
}

function nonTenant(
  parsed: ParsedHost,
  reason: NonTenantAdvocateHostReason,
): AdvocateHostResolution {
  return {
    kind: "non-tenant",
    reason,
    normalizedHostname: parsed.hostname,
    port: parsed.port,
  }
}

function resolveOneLabelTenant(
  parsed: ParsedHost,
  tenantLabel: string,
  environment: "production" | "local-development",
): AdvocateHostResolution {
  if (tenantLabel.includes(".")) {
    return nonTenant(parsed, "nested-subdomain")
  }

  if (RESERVED_SUBDOMAIN_SET.has(tenantLabel)) {
    return nonTenant(parsed, "reserved-subdomain")
  }

  const lookupHostname = `${tenantLabel}.${ADVOCATE_TENANT_ROOT}`

  return {
    kind: "tenant-candidate",
    environment,
    requestHostname: parsed.hostname,
    requestPort: parsed.port,
    tenantLabel,
    domainLookup: {
      hostname: environment === "production" ? parsed.hostname : lookupHostname,
      requiredStatus: "active",
    },
  }
}

/**
 * Classifies an HTTP Host header without asserting that an advocate exists.
 * A tenant candidate must still be resolved by an exact hostname and active
 * status lookup in advocate_domains. No valid-looking label is an identity.
 */
export function resolveAdvocateHost(
  rawHost: string | null | undefined,
  options: ResolveAdvocateHostOptions = {},
): AdvocateHostResolution {
  const parsed = parseHostHeader(rawHost)
  if (!("hostname" in parsed)) return parsed

  if (parsed.loopback) return nonTenant(parsed, "loopback-address")

  if (parsed.hostname === ADVOCATE_TENANT_ROOT) {
    return nonTenant(parsed, "tenant-root")
  }

  const productionSuffix = `.${ADVOCATE_TENANT_ROOT}`
  if (parsed.hostname.endsWith(productionSuffix)) {
    const tenantLabel = parsed.hostname.slice(0, -productionSuffix.length)
    return resolveOneLabelTenant(parsed, tenantLabel, "production")
  }

  if (parsed.hostname === ADVOCATE_LOCALHOST_ROOT) {
    return nonTenant(parsed, "localhost-root")
  }

  const localhostSuffix = `.${ADVOCATE_LOCALHOST_ROOT}`
  if (parsed.hostname.endsWith(localhostSuffix)) {
    const tenantLabel = parsed.hostname.slice(0, -localhostSuffix.length)
    const classification = resolveOneLabelTenant(
      parsed,
      tenantLabel,
      "local-development",
    )

    if (classification.kind !== "tenant-candidate") return classification
    if (!options.allowLocalhostDevelopment) {
      return nonTenant(parsed, "local-development-disabled")
    }

    return classification
  }

  return nonTenant(parsed, "outside-tenant-root")
}
