import {
  COMMITTED_COOKIE_TRUST_POLICY,
  evaluateCookieTrustPolicy,
} from "./cookieTrustInventory"
import {
  ADVOCATE_STAGING_TENANT_ROOT,
  ADVOCATE_TENANT_ROOT,
  isAdvocateStagingEnvironmentEnabled,
  resolveAdvocateHost,
} from "./host"

export const CROSS_SUBDOMAIN_COOKIE_MODE_ENVIRONMENT_VARIABLE =
  "ADVOCATE_CROSS_SUBDOMAIN_COOKIE_MODE"
export const COOKIE_TRUST_POLICY_DIGEST_ENVIRONMENT_VARIABLE =
  "ADVOCATE_COOKIE_TRUST_POLICY_DIGEST"

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/

export type CrossSubdomainCookieTrustEnvironment = Readonly<
  Record<string, string | undefined>
>

export type CrossSubdomainCookieTrustGateReason =
  | "active"
  | "policy_digest_invalid"
  | "policy_digest_mismatch"
  | "policy_digest_missing"
  | "mode_invalid"
  | "mode_missing"
  | "local_test_override"
  | "policy_malformed"
  | "policy_pending"
  | "trusted_collector_missing"
  | "runtime_not_production"

export interface CrossSubdomainCookieLocalTestOptions {
  /**
   * This is an intentionally loud test seam. Runtime code must never set it.
   * The gate also requires NODE_ENV=test, so it cannot bypass production.
   */
  unsafeAllowParentDomainCookiesForLocalTests?: true
}

export type CrossSubdomainCookieCryptographicScope = "parent" | `host:${string}`

export interface CrossSubdomainCookieTrustGateResult {
  state: "active" | "host_only"
  reason: CrossSubdomainCookieTrustGateReason
  policyDigest: string | null
}

export interface CrossSubdomainCookieScope {
  creatorShareHost: boolean
  cryptographicScope: CrossSubdomainCookieCryptographicScope | null
  domain: `.${typeof ADVOCATE_TENANT_ROOT}` | undefined
  deleteHostOnlyBeforeWrite: boolean
  deleteParentDomainBeforeWrite: boolean
}

const COMMITTED_POLICY_RESULT = evaluateCookieTrustPolicy(
  COMMITTED_COOKIE_TRUST_POLICY,
)

export function evaluateCrossSubdomainCookieTrustGate(
  environment: CrossSubdomainCookieTrustEnvironment = process.env,
  policy: unknown = COMMITTED_COOKIE_TRUST_POLICY,
  localTestOptions: CrossSubdomainCookieLocalTestOptions = {},
): CrossSubdomainCookieTrustGateResult {
  if (
    environment.NODE_ENV === "test" &&
    localTestOptions.unsafeAllowParentDomainCookiesForLocalTests === true
  ) {
    return Object.freeze({
      state: "active" as const,
      reason: "local_test_override" as const,
      policyDigest:
        policy === COMMITTED_COOKIE_TRUST_POLICY
          ? COMMITTED_POLICY_RESULT.policyDigest
          : evaluateCookieTrustPolicy(policy).policyDigest,
    })
  }

  if (environment.NODE_ENV !== "production") {
    return Object.freeze({
      state: "host_only" as const,
      reason: "runtime_not_production" as const,
      policyDigest: null,
    })
  }

  const mode = environment[CROSS_SUBDOMAIN_COOKIE_MODE_ENVIRONMENT_VARIABLE]
  if (mode === undefined || mode === "") {
    return Object.freeze({
      state: "host_only" as const,
      reason: "mode_missing" as const,
      policyDigest: null,
    })
  }
  if (mode !== "active") {
    return Object.freeze({
      state: "host_only" as const,
      reason: "mode_invalid" as const,
      policyDigest: null,
    })
  }

  const configuredDigest =
    environment[COOKIE_TRUST_POLICY_DIGEST_ENVIRONMENT_VARIABLE]
  if (configuredDigest === undefined || configuredDigest === "") {
    return Object.freeze({
      state: "host_only" as const,
      reason: "policy_digest_missing" as const,
      policyDigest: null,
    })
  }
  if (!SHA256_HEX_PATTERN.test(configuredDigest)) {
    return Object.freeze({
      state: "host_only" as const,
      reason: "policy_digest_invalid" as const,
      policyDigest: null,
    })
  }

  const policyResult =
    policy === COMMITTED_COOKIE_TRUST_POLICY
      ? COMMITTED_POLICY_RESULT
      : evaluateCookieTrustPolicy(policy)
  if (policyResult.policyDigest !== configuredDigest) {
    return Object.freeze({
      state: "host_only" as const,
      reason: "policy_digest_mismatch" as const,
      policyDigest: policyResult.policyDigest,
    })
  }
  if (policyResult.state !== "approved") {
    return Object.freeze({
      state: "host_only" as const,
      reason:
        policyResult.reason === "approved"
          ? ("policy_malformed" as const)
          : policyResult.reason,
      policyDigest: policyResult.policyDigest,
    })
  }

  // A committed topology digest proves only what reviewers approved at one
  // point in time. It cannot detect a later DNS, hosting attachment, or
  // managed-domain change. Production parent-domain cookies therefore remain
  // unavailable until a separately reviewed architecture supplies trusted,
  // fresh provider evidence and a continuous drift response. The explicit
  // local test seam above is the only activation path in this slice.
  return Object.freeze({
    state: "host_only" as const,
    reason: "trusted_collector_missing" as const,
    policyDigest: policyResult.policyDigest,
  })
}

export function resolveCrossSubdomainCookieScope(
  rawHost: string | null,
  environment: CrossSubdomainCookieTrustEnvironment = process.env,
  policy: unknown = COMMITTED_COOKIE_TRUST_POLICY,
  localTestOptions: CrossSubdomainCookieLocalTestOptions = {},
): CrossSubdomainCookieScope {
  const resolution = resolveAdvocateHost(rawHost, {
    allowLocalhostDevelopment: true,
  })
  if (resolution.kind === "invalid") {
    return Object.freeze({
      creatorShareHost: false,
      cryptographicScope: null,
      domain: undefined,
      deleteHostOnlyBeforeWrite: false,
      deleteParentDomainBeforeWrite: false,
    })
  }
  const hostname =
    resolution.kind === "tenant-candidate"
      ? resolution.requestHostname
      : resolution.normalizedHostname
  const isolatedStagingHost =
    isAdvocateStagingEnvironmentEnabled(environment) &&
    (hostname === ADVOCATE_STAGING_TENANT_ROOT ||
      hostname.endsWith(`.${ADVOCATE_STAGING_TENANT_ROOT}`))
  if (isolatedStagingHost) {
    return Object.freeze({
      creatorShareHost: false,
      cryptographicScope: `host:${hostname}` as const,
      domain: undefined,
      deleteHostOnlyBeforeWrite: false,
      deleteParentDomainBeforeWrite: false,
    })
  }
  const creatorShareHost =
    hostname === ADVOCATE_TENANT_ROOT ||
    hostname.endsWith(`.${ADVOCATE_TENANT_ROOT}`)
  if (!creatorShareHost) {
    return Object.freeze({
      creatorShareHost: false,
      cryptographicScope: `host:${hostname}` as const,
      domain: undefined,
      deleteHostOnlyBeforeWrite: false,
      deleteParentDomainBeforeWrite: false,
    })
  }

  const gate = evaluateCrossSubdomainCookieTrustGate(
    environment,
    policy,
    localTestOptions,
  )
  const parentDomainActive = gate.state === "active"
  return Object.freeze({
    creatorShareHost: true,
    cryptographicScope: parentDomainActive
      ? ("parent" as const)
      : (`host:${hostname}` as const),
    domain: parentDomainActive ? `.${ADVOCATE_TENANT_ROOT}` : undefined,
    deleteHostOnlyBeforeWrite: parentDomainActive,
    deleteParentDomainBeforeWrite: !parentDomainActive,
  })
}

export function crossSubdomainCookiesAreActive(
  environment: CrossSubdomainCookieTrustEnvironment = process.env,
): boolean {
  return evaluateCrossSubdomainCookieTrustGate(environment).state === "active"
}
