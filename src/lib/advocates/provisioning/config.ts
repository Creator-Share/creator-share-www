import { DomainProvisioningError } from "./types"

export interface CloudflareProvisioningConfig {
  apiToken: string
  zoneId: string
  cnameTarget: string
  ttl: number
  requestTimeoutMs: number
}

export interface VercelProvisioningConfig {
  apiToken: string
  projectId: string
  teamId?: string
  requestTimeoutMs: number
}

export interface DomainWorkerConfig {
  batchSize: number
  leaseSeconds: number
}

export type ProvisioningEnvironment = Readonly<
  Record<string, string | undefined>
>

const DNS_HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

function configurationError(cause?: unknown): DomainProvisioningError {
  return new DomainProvisioningError({
    code: "worker_configuration_invalid",
    retryable: false,
    cause,
  })
}

function requireSecret(
  env: ProvisioningEnvironment,
  key: string,
  minimumLength = 20,
): string {
  const value = env[key]
  if (
    typeof value !== "string" ||
    value.length < minimumLength ||
    value.length > 2048 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f\s]/.test(value)
  ) {
    throw configurationError()
  }
  return value
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw configurationError()
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw configurationError()
  }
  return parsed
}

function normalizeDnsHostname(value: string | undefined): string {
  if (!value) throw configurationError()
  const normalized = value.toLowerCase().replace(/\.$/, "")
  if (normalized !== value.toLowerCase() || !DNS_HOSTNAME_PATTERN.test(normalized)) {
    throw configurationError()
  }
  return normalized
}

export function loadCloudflareProvisioningConfig(
  env: ProvisioningEnvironment = process.env,
): CloudflareProvisioningConfig {
  const zoneId = env.ADVOCATE_CLOUDFLARE_ZONE_ID
  if (!zoneId || !/^[0-9a-f]{32}$/i.test(zoneId)) {
    throw configurationError()
  }

  return {
    apiToken: requireSecret(env, "ADVOCATE_CLOUDFLARE_API_TOKEN"),
    zoneId,
    cnameTarget: normalizeDnsHostname(
      env.ADVOCATE_CLOUDFLARE_CNAME_TARGET,
    ),
    ttl: parseBoundedInteger(
      env.ADVOCATE_CLOUDFLARE_TTL_SECONDS,
      300,
      60,
      86400,
    ),
    requestTimeoutMs: parseBoundedInteger(
      env.ADVOCATE_PROVISIONING_REQUEST_TIMEOUT_MS,
      15_000,
      1_000,
      60_000,
    ),
  }
}

export function loadVercelProvisioningConfig(
  env: ProvisioningEnvironment = process.env,
): VercelProvisioningConfig {
  const projectId = env.ADVOCATE_VERCEL_PROJECT_ID
  const teamId = env.ADVOCATE_VERCEL_TEAM_ID

  if (!projectId || !/^prj_[A-Za-z0-9]{8,128}$/.test(projectId)) {
    throw configurationError()
  }
  if (teamId && !/^team_[A-Za-z0-9]{8,128}$/.test(teamId)) {
    throw configurationError()
  }

  return {
    apiToken: requireSecret(env, "ADVOCATE_VERCEL_API_TOKEN"),
    projectId,
    ...(teamId ? { teamId } : {}),
    requestTimeoutMs: parseBoundedInteger(
      env.ADVOCATE_PROVISIONING_REQUEST_TIMEOUT_MS,
      15_000,
      1_000,
      60_000,
    ),
  }
}

export function loadDomainWorkerConfig(
  env: ProvisioningEnvironment = process.env,
): DomainWorkerConfig {
  return {
    batchSize: parseBoundedInteger(
      env.ADVOCATE_PROVISIONING_BATCH_SIZE,
      3,
      1,
      10,
    ),
    leaseSeconds: parseBoundedInteger(
      env.ADVOCATE_PROVISIONING_LEASE_SECONDS,
      300,
      30,
      900,
    ),
  }
}

export function loadWorkerRouteSecret(
  env: ProvisioningEnvironment = process.env,
): string {
  return requireSecret(env, "ADVOCATE_PROVISIONING_WORKER_SECRET", 32)
}
