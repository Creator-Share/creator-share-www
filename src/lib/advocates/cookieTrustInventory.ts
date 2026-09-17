import committedPolicy from "../../../config/creator-share-cookie-trust.json"

import { sha256 } from "@noble/hashes/sha256"

import { resolveAdvocateHost } from "./host"

const TENANT_ROOT = "creatorshare.com"
const SENTINEL_HOSTNAME = `publication-sentinel.${TENANT_ROOT}`
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/
const DNS_OWNER_NAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*$/
const REVISION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/
const VERCEL_CNAME_PATTERN = /^[a-z0-9]{8,64}\.vercel-dns-[0-9]{3}\.com$/
const VERCEL_APEX_IPV4_ADDRESS = "76.76.21.21"
const VERCEL_PROJECT_ID_PATTERN = /^prj_[A-Za-z0-9]{8,128}$/
const PROVIDER_BINDING_PATTERN = /^[A-Za-z0-9._/-]{1,255}$/
const IPV4_PATTERN = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/
const IPV6_PATTERN = /^[0-9a-f:]+$/
const PRINTABLE_DNS_CONTENT_PATTERN = /^[\x20-\x7e]{1,1024}$/
const TEXT_ENCODER = new TextEncoder()

const POLICY_KEYS = Object.freeze([
  "advocateCnameTarget",
  "policyRevision",
  "reviewState",
  "schemaVersion",
  "staticHosts",
  "tenantRoot",
  "vercelProjectId",
] as const)
const STATIC_HOST_KEYS = Object.freeze([
  "dnsRecords",
  "hostname",
  "role",
] as const)
const DNS_RECORD_KEYS = Object.freeze(["content", "proxied", "type"] as const)
const SNAPSHOT_KEYS = Object.freeze([
  "cloudflareDnsRecords",
  "managedAdvocateDomains",
  "policyDigest",
  "schemaVersion",
  "sourceCompleteness",
  "vercelTeamDomainAttachments",
] as const)
const SOURCE_COMPLETENESS_KEYS = Object.freeze([
  "cloudflareDnsRecords",
  "managedAdvocateDomains",
  "vercelTeamDomainAttachments",
] as const)
const CLOUDFLARE_RECORD_KEYS = Object.freeze([
  "content",
  "hostname",
  "proxied",
  "type",
] as const)
const VERCEL_DOMAIN_KEYS = Object.freeze([
  "customEnvironmentId",
  "gitBranch",
  "hostname",
  "projectId",
  "redirectStatusCode",
  "redirectTarget",
  "verified",
] as const)
const MANAGED_DOMAIN_KEYS = Object.freeze(["hostname", "lifecycle"] as const)

const CLOUDFLARE_COMPLETE_TENANT_ZONE =
  "all_records_in_creator_share_tenant_zone"
const MANAGED_DOMAINS_COMPLETE =
  "all_database_managed_domains_except_cleanup_verified"
const VERCEL_TEAM_ATTACHMENTS_COMPLETE =
  "all_creator_share_sibling_attachments_visible_to_owning_team"

export type CookieTrustPolicyReviewState = "approved" | "pending"
export type StaticCookieTrustHostRole = "primary" | "sentinel" | "static"
export type CookieTrustDnsRecordType =
  | "A"
  | "AAAA"
  | "CAA"
  | "CERT"
  | "CNAME"
  | "DNSKEY"
  | "DS"
  | "HTTPS"
  | "LOC"
  | "MX"
  | "NAPTR"
  | "NS"
  | "OPENPGPKEY"
  | "PTR"
  | "SMIMEA"
  | "SRV"
  | "SSHFP"
  | "SVCB"
  | "TLSA"
  | "TXT"
  | "URI"

export interface CookieTrustDnsRecord {
  type: CookieTrustDnsRecordType
  content: string
  proxied: boolean
}

export interface StaticCookieTrustHostPolicy {
  hostname: string
  role: StaticCookieTrustHostRole
  dnsRecords: readonly CookieTrustDnsRecord[]
}

export interface CookieTrustPolicy {
  schemaVersion: 1
  reviewState: CookieTrustPolicyReviewState
  tenantRoot: typeof TENANT_ROOT
  policyRevision: string
  advocateCnameTarget: string | null
  vercelProjectId: string | null
  staticHosts: readonly StaticCookieTrustHostPolicy[]
}

export interface CloudflareCookieTrustDnsRecord extends CookieTrustDnsRecord {
  hostname: string
}

export interface VercelCookieTrustTeamDomainAttachment {
  hostname: string
  projectId: string
  verified: boolean
  redirectTarget: string | null
  redirectStatusCode: number | null
  gitBranch: string | null
  customEnvironmentId: string | null
}

export type ManagedAdvocateCookieTrustDomainLifecycle =
  | "active"
  | "archive_quiescence"
  | "failed_retained"
  | "provisioning"
  | "suspended"
  | "verifying"

export interface ManagedAdvocateCookieTrustDomain {
  hostname: string
  lifecycle: ManagedAdvocateCookieTrustDomainLifecycle
}

export interface CookieTrustAuditSnapshot {
  schemaVersion: 1
  policyDigest: string
  sourceCompleteness: Readonly<{
    cloudflareDnsRecords: typeof CLOUDFLARE_COMPLETE_TENANT_ZONE
    managedAdvocateDomains: typeof MANAGED_DOMAINS_COMPLETE
    vercelTeamDomainAttachments: typeof VERCEL_TEAM_ATTACHMENTS_COMPLETE
  }>
  cloudflareDnsRecords: readonly CloudflareCookieTrustDnsRecord[]
  managedAdvocateDomains: readonly ManagedAdvocateCookieTrustDomain[]
  vercelTeamDomainAttachments: readonly VercelCookieTrustTeamDomainAttachment[]
}

export type CookieTrustPolicyReason =
  "approved" | "policy_malformed" | "policy_pending"

export interface CookieTrustPolicyResult {
  schemaVersion: 1
  state: "approved" | "blocked"
  reason: CookieTrustPolicyReason
  policyDigest: string | null
}

export type CookieTrustAuditReason =
  | CookieTrustPolicyReason
  | "abandoned_attachment"
  | "approved"
  | "delegated_zone"
  | "inventory_drift"
  | "managed_domain_conflict"
  | "missing_sibling"
  | "missing_vercel_attachment"
  | "snapshot_malformed"
  | "unexpected_cname"
  | "unexpected_dns_records"
  | "unexpected_vercel_attachment"
  | "unknown_sibling"
  | "vercel_attachment_unverified"
  | "vercel_project_mismatch"
  | "wildcard_sibling"

export interface CookieTrustAuditResult {
  schemaVersion: 1
  state: "approved" | "blocked"
  reason: CookieTrustAuditReason
  policyDigest: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function isCanonicalHostname(value: unknown): value is string {
  return (
    typeof value === "string" &&
    HOSTNAME_PATTERN.test(value) &&
    value === value.toLowerCase()
  )
}

function isCanonicalDnsOwnerName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    DNS_OWNER_NAME_PATTERN.test(value) &&
    value === value.toLowerCase()
  )
}

function isTenantDnsOwnerName(ownerName: string): boolean {
  return ownerName === TENANT_ROOT || ownerName.endsWith(`.${TENANT_ROOT}`)
}

function parseIpv4(value: string): boolean {
  return (
    IPV4_PATTERN.test(value) &&
    value.split(".").every((part) => {
      const parsed = Number(part)
      return String(parsed) === part && parsed >= 0 && parsed <= 255
    })
  )
}

function isValidDnsContent(
  type: CookieTrustDnsRecordType,
  content: unknown,
): content is string {
  if (typeof content !== "string") return false
  if (type === "A") return parseIpv4(content)
  if (type === "AAAA") {
    return (
      content.length >= 2 &&
      content.length <= 39 &&
      content.includes(":") &&
      IPV6_PATTERN.test(content)
    )
  }
  if (type === "CNAME") return isCanonicalDnsOwnerName(content)
  if (type === "NS") return isCanonicalHostname(content)
  return PRINTABLE_DNS_CONTENT_PATTERN.test(content)
}

function parseDnsRecord(value: unknown): CookieTrustDnsRecord | null {
  if (!isRecord(value) || !hasExactKeys(value, DNS_RECORD_KEYS)) return null
  if (
    ![
      "A",
      "AAAA",
      "CAA",
      "CERT",
      "CNAME",
      "DNSKEY",
      "DS",
      "HTTPS",
      "LOC",
      "MX",
      "NAPTR",
      "NS",
      "OPENPGPKEY",
      "PTR",
      "SMIMEA",
      "SRV",
      "SSHFP",
      "SVCB",
      "TLSA",
      "TXT",
      "URI",
    ].includes(value.type as string) ||
    typeof value.proxied !== "boolean"
  ) {
    return null
  }
  const type = value.type as CookieTrustDnsRecordType
  if (!isValidDnsContent(type, value.content)) return null
  return Object.freeze({
    type,
    content: value.content,
    proxied: value.proxied,
  })
}

function dnsRecordKey(record: CookieTrustDnsRecord): string {
  return `${record.type}\0${record.content}\0${record.proxied ? "1" : "0"}`
}

function cloudflareRecordKey(record: CloudflareCookieTrustDnsRecord): string {
  return `${record.hostname}\0${dnsRecordKey(record)}`
}

function isUniqueSorted<T>(
  values: readonly T[],
  key: (value: T) => string,
): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (key(values[index - 1]) >= key(values[index])) return false
  }
  return true
}

function parseStaticHost(value: unknown): StaticCookieTrustHostPolicy | null {
  if (!isRecord(value) || !hasExactKeys(value, STATIC_HOST_KEYS)) return null
  if (
    !isCanonicalDnsOwnerName(value.hostname) ||
    !isTenantDnsOwnerName(value.hostname) ||
    !["primary", "sentinel", "static"].includes(value.role as string) ||
    !Array.isArray(value.dnsRecords) ||
    value.dnsRecords.length === 0 ||
    value.dnsRecords.length > 64
  ) {
    return null
  }
  const dnsRecords = value.dnsRecords.map(parseDnsRecord)
  if (dnsRecords.some((record) => record === null)) return null
  const parsedDnsRecords = dnsRecords as CookieTrustDnsRecord[]
  if (!isUniqueSorted(parsedDnsRecords, dnsRecordKey)) return null

  return Object.freeze({
    hostname: value.hostname,
    role: value.role as StaticCookieTrustHostRole,
    dnsRecords: Object.freeze(parsedDnsRecords),
  })
}

function staticDnsOwnerRequiresVercelAttachment(
  staticHost: StaticCookieTrustHostPolicy,
): boolean {
  if (!isCanonicalHostname(staticHost.hostname)) return false
  return staticHost.dnsRecords.some((record) =>
    ["A", "AAAA", "CNAME", "HTTPS", "SVCB"].includes(record.type),
  )
}

function hasExactUnproxiedVercelRouting(
  staticHost: StaticCookieTrustHostPolicy,
  advocateCnameTarget: string,
): boolean {
  if (!staticDnsOwnerRequiresVercelAttachment(staticHost)) return true
  const routingRecords = staticHost.dnsRecords.filter((record) =>
    ["A", "AAAA", "CNAME", "HTTPS", "SVCB"].includes(record.type),
  )
  if (
    routingRecords.length !== 1 ||
    routingRecords[0].proxied ||
    ["AAAA", "HTTPS", "SVCB"].includes(routingRecords[0].type)
  ) {
    return false
  }
  if (staticHost.hostname === TENANT_ROOT) {
    return (
      routingRecords[0].type === "A" &&
      routingRecords[0].content === VERCEL_APEX_IPV4_ADDRESS
    )
  }
  return (
    routingRecords[0].type === "CNAME" &&
    routingRecords[0].content === advocateCnameTarget
  )
}

function hasRequiredStaticTopology(
  staticHosts: readonly StaticCookieTrustHostPolicy[],
  advocateCnameTarget: string,
): boolean {
  const primaryHosts = staticHosts.filter((host) => host.role === "primary")
  const sentinelHosts = staticHosts.filter((host) => host.role === "sentinel")
  const otherStaticHosts = staticHosts.filter((host) => host.role === "static")
  if (
    primaryHosts.length !== 1 ||
    primaryHosts[0].hostname !== TENANT_ROOT ||
    sentinelHosts.length !== 1 ||
    sentinelHosts[0].hostname !== SENTINEL_HOSTNAME ||
    otherStaticHosts.length === 0
  ) {
    return false
  }
  const sentinel = sentinelHosts[0]
  return (
    staticHosts.every((host) =>
      hasExactUnproxiedVercelRouting(host, advocateCnameTarget),
    ) &&
    staticDnsOwnerRequiresVercelAttachment(sentinel) &&
    sentinel.dnsRecords.length === 1 &&
    sentinel.dnsRecords[0].type === "CNAME" &&
    sentinel.dnsRecords[0].content === advocateCnameTarget &&
    !sentinel.dnsRecords[0].proxied
  )
}

export function parseCookieTrustPolicy(
  value: unknown,
): CookieTrustPolicy | null {
  if (!isRecord(value) || !hasExactKeys(value, POLICY_KEYS)) return null
  if (
    value.schemaVersion !== 1 ||
    !["approved", "pending"].includes(value.reviewState as string) ||
    value.tenantRoot !== TENANT_ROOT ||
    typeof value.policyRevision !== "string" ||
    !REVISION_PATTERN.test(value.policyRevision) ||
    !Array.isArray(value.staticHosts) ||
    value.staticHosts.length > 1_024
  ) {
    return null
  }

  const staticHosts = value.staticHosts.map(parseStaticHost)
  if (staticHosts.some((host) => host === null)) return null
  const parsedStaticHosts = staticHosts as StaticCookieTrustHostPolicy[]
  if (!isUniqueSorted(parsedStaticHosts, (host) => host.hostname)) return null

  if (value.reviewState === "pending") {
    if (
      value.advocateCnameTarget !== null ||
      value.vercelProjectId !== null ||
      parsedStaticHosts.length !== 0
    ) {
      return null
    }
  } else if (
    typeof value.advocateCnameTarget !== "string" ||
    !VERCEL_CNAME_PATTERN.test(value.advocateCnameTarget) ||
    typeof value.vercelProjectId !== "string" ||
    !VERCEL_PROJECT_ID_PATTERN.test(value.vercelProjectId) ||
    !hasRequiredStaticTopology(
      parsedStaticHosts,
      value.advocateCnameTarget as string,
    )
  ) {
    return null
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    reviewState: value.reviewState as CookieTrustPolicyReviewState,
    tenantRoot: TENANT_ROOT,
    policyRevision: value.policyRevision,
    advocateCnameTarget: value.advocateCnameTarget as string | null,
    vercelProjectId: value.vercelProjectId as string | null,
    staticHosts: Object.freeze(parsedStaticHosts),
  })
}

function canonicalPolicyJson(policy: CookieTrustPolicy): string {
  return JSON.stringify({
    schemaVersion: policy.schemaVersion,
    reviewState: policy.reviewState,
    tenantRoot: policy.tenantRoot,
    policyRevision: policy.policyRevision,
    advocateCnameTarget: policy.advocateCnameTarget,
    vercelProjectId: policy.vercelProjectId,
    staticHosts: policy.staticHosts.map((host) => ({
      hostname: host.hostname,
      role: host.role,
      dnsRecords: host.dnsRecords.map((record) => ({
        type: record.type,
        content: record.content,
        proxied: record.proxied,
      })),
    })),
  })
}

export function cookieTrustPolicyDigest(value: unknown): string | null {
  const policy = parseCookieTrustPolicy(value)
  if (policy === null) return null
  return Array.from(sha256(TEXT_ENCODER.encode(canonicalPolicyJson(policy))))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export function evaluateCookieTrustPolicy(
  value: unknown,
): CookieTrustPolicyResult {
  const policy = parseCookieTrustPolicy(value)
  const policyDigest = cookieTrustPolicyDigest(value)
  if (policy === null || policyDigest === null) {
    return Object.freeze({
      schemaVersion: 1 as const,
      state: "blocked" as const,
      reason: "policy_malformed" as const,
      policyDigest: null,
    })
  }
  if (policy.reviewState !== "approved") {
    return Object.freeze({
      schemaVersion: 1 as const,
      state: "blocked" as const,
      reason: "policy_pending" as const,
      policyDigest,
    })
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    state: "approved" as const,
    reason: "approved" as const,
    policyDigest,
  })
}

function parseCloudflareRecord(
  value: unknown,
): CloudflareCookieTrustDnsRecord | null {
  if (!isRecord(value) || !hasExactKeys(value, CLOUDFLARE_RECORD_KEYS)) {
    return null
  }
  const wildcardHostname =
    typeof value.hostname === "string" &&
    value.hostname.startsWith("*.") &&
    isCanonicalDnsOwnerName(value.hostname.slice(2))
  const regularHostname = isCanonicalDnsOwnerName(value.hostname)
  if (!regularHostname && !wildcardHostname) return null
  const normalizedHostname = wildcardHostname
    ? (value.hostname as string).slice(2)
    : (value.hostname as string)
  if (!isTenantDnsOwnerName(normalizedHostname)) return null

  const record = parseDnsRecord({
    type: value.type,
    content: value.content,
    proxied: value.proxied,
  })
  if (record === null) return null
  return Object.freeze({
    hostname: value.hostname as string,
    ...record,
  })
}

function parseNullableProviderBinding(value: unknown): string | null | false {
  if (value === null) return null
  return typeof value === "string" && PROVIDER_BINDING_PATTERN.test(value)
    ? value
    : false
}

function parseVercelProjectDomain(
  value: unknown,
): VercelCookieTrustTeamDomainAttachment | null {
  if (!isRecord(value) || !hasExactKeys(value, VERCEL_DOMAIN_KEYS)) return null
  if (
    !isCanonicalHostname(value.hostname) ||
    !isTenantDnsOwnerName(value.hostname) ||
    typeof value.projectId !== "string" ||
    !VERCEL_PROJECT_ID_PATTERN.test(value.projectId) ||
    typeof value.verified !== "boolean"
  ) {
    return null
  }
  const redirectTarget = parseNullableProviderBinding(value.redirectTarget)
  const redirectStatusCode =
    value.redirectStatusCode === null
      ? null
      : typeof value.redirectStatusCode === "number" &&
          Number.isInteger(value.redirectStatusCode) &&
          value.redirectStatusCode >= 300 &&
          value.redirectStatusCode <= 399
        ? value.redirectStatusCode
        : false
  const gitBranch = parseNullableProviderBinding(value.gitBranch)
  const customEnvironmentId = parseNullableProviderBinding(
    value.customEnvironmentId,
  )
  if (
    redirectTarget === false ||
    redirectStatusCode === false ||
    gitBranch === false ||
    customEnvironmentId === false
  ) {
    return null
  }
  return Object.freeze({
    hostname: value.hostname,
    projectId: value.projectId,
    verified: value.verified,
    redirectTarget,
    redirectStatusCode,
    gitBranch,
    customEnvironmentId,
  })
}

function parseManagedAdvocateDomain(
  value: unknown,
): ManagedAdvocateCookieTrustDomain | null {
  if (!isRecord(value) || !hasExactKeys(value, MANAGED_DOMAIN_KEYS)) return null
  if (
    !isCanonicalHostname(value.hostname) ||
    ![
      "active",
      "archive_quiescence",
      "failed_retained",
      "provisioning",
      "suspended",
      "verifying",
    ].includes(value.lifecycle as string)
  ) {
    return null
  }
  const hostResolution = resolveAdvocateHost(value.hostname)
  if (hostResolution.kind !== "tenant-candidate") {
    return null
  }
  return Object.freeze({
    hostname: value.hostname,
    lifecycle: value.lifecycle as ManagedAdvocateCookieTrustDomainLifecycle,
  })
}

export function parseCookieTrustAuditSnapshot(
  value: unknown,
): CookieTrustAuditSnapshot | null {
  if (!isRecord(value) || !hasExactKeys(value, SNAPSHOT_KEYS)) return null
  if (
    value.schemaVersion !== 1 ||
    typeof value.policyDigest !== "string" ||
    !SHA256_HEX_PATTERN.test(value.policyDigest) ||
    !isRecord(value.sourceCompleteness) ||
    !hasExactKeys(value.sourceCompleteness, SOURCE_COMPLETENESS_KEYS) ||
    value.sourceCompleteness.cloudflareDnsRecords !==
      CLOUDFLARE_COMPLETE_TENANT_ZONE ||
    value.sourceCompleteness.managedAdvocateDomains !==
      MANAGED_DOMAINS_COMPLETE ||
    value.sourceCompleteness.vercelTeamDomainAttachments !==
      VERCEL_TEAM_ATTACHMENTS_COMPLETE ||
    !Array.isArray(value.cloudflareDnsRecords) ||
    !Array.isArray(value.managedAdvocateDomains) ||
    !Array.isArray(value.vercelTeamDomainAttachments) ||
    value.cloudflareDnsRecords.length > 16_384 ||
    value.managedAdvocateDomains.length > 2_048 ||
    value.vercelTeamDomainAttachments.length > 2_048
  ) {
    return null
  }

  const cloudflareDnsRecords = value.cloudflareDnsRecords.map(
    parseCloudflareRecord,
  )
  const vercelTeamDomainAttachments = value.vercelTeamDomainAttachments.map(
    parseVercelProjectDomain,
  )
  const managedAdvocateDomains = value.managedAdvocateDomains.map(
    parseManagedAdvocateDomain,
  )
  if (
    cloudflareDnsRecords.some((record) => record === null) ||
    vercelTeamDomainAttachments.some((domain) => domain === null) ||
    managedAdvocateDomains.some((domain) => domain === null)
  ) {
    return null
  }

  const parsedCloudflareDnsRecords =
    cloudflareDnsRecords as CloudflareCookieTrustDnsRecord[]
  const parsedVercelTeamDomainAttachments =
    vercelTeamDomainAttachments as VercelCookieTrustTeamDomainAttachment[]
  const parsedManagedAdvocateDomains =
    managedAdvocateDomains as ManagedAdvocateCookieTrustDomain[]
  if (
    !isUniqueSorted(parsedCloudflareDnsRecords, cloudflareRecordKey) ||
    !isUniqueSorted(
      parsedVercelTeamDomainAttachments,
      (domain) => domain.hostname,
    ) ||
    !isUniqueSorted(parsedManagedAdvocateDomains, (domain) => domain.hostname)
  ) {
    return null
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    policyDigest: value.policyDigest,
    sourceCompleteness: Object.freeze({
      cloudflareDnsRecords: CLOUDFLARE_COMPLETE_TENANT_ZONE,
      managedAdvocateDomains: MANAGED_DOMAINS_COMPLETE,
      vercelTeamDomainAttachments: VERCEL_TEAM_ATTACHMENTS_COMPLETE,
    }),
    cloudflareDnsRecords: Object.freeze(parsedCloudflareDnsRecords),
    managedAdvocateDomains: Object.freeze(parsedManagedAdvocateDomains),
    vercelTeamDomainAttachments: Object.freeze(
      parsedVercelTeamDomainAttachments,
    ),
  })
}

function auditBlocked(
  reason: Exclude<CookieTrustAuditReason, "approved">,
  policyDigest: string | null,
): CookieTrustAuditResult {
  return Object.freeze({
    schemaVersion: 1 as const,
    state: "blocked" as const,
    reason,
    policyDigest,
  })
}

function exactDnsRecords(
  expected: readonly CookieTrustDnsRecord[],
  observed: readonly CookieTrustDnsRecord[],
): boolean {
  return (
    expected.length === observed.length &&
    expected.every(
      (record, index) => dnsRecordKey(record) === dnsRecordKey(observed[index]),
    )
  )
}

function isSingleUnexpectedCname(
  expected: readonly CookieTrustDnsRecord[],
  observed: readonly CookieTrustDnsRecord[],
): boolean {
  return (
    expected.length === 1 &&
    observed.length === 1 &&
    expected[0].type === "CNAME" &&
    observed[0].type === "CNAME" &&
    expected[0].content !== observed[0].content
  )
}

export function evaluateCookieTrustAudit(
  policyValue: unknown,
  snapshotValue: unknown,
): CookieTrustAuditResult {
  const policyResult = evaluateCookieTrustPolicy(policyValue)
  if (policyResult.state !== "approved") {
    return auditBlocked(
      policyResult.reason === "approved"
        ? "policy_malformed"
        : policyResult.reason,
      policyResult.policyDigest,
    )
  }
  const policy = parseCookieTrustPolicy(policyValue)
  const snapshot = parseCookieTrustAuditSnapshot(snapshotValue)
  if (policy === null) return auditBlocked("policy_malformed", null)
  if (snapshot === null) {
    return auditBlocked("snapshot_malformed", policyResult.policyDigest)
  }
  if (snapshot.policyDigest !== policyResult.policyDigest) {
    return auditBlocked("inventory_drift", policyResult.policyDigest)
  }

  if (
    snapshot.cloudflareDnsRecords.some((record) =>
      record.hostname.startsWith("*."),
    )
  ) {
    return auditBlocked("wildcard_sibling", policyResult.policyDigest)
  }
  if (
    snapshot.cloudflareDnsRecords.some(
      (record) => record.type === "NS" && record.hostname !== TENANT_ROOT,
    )
  ) {
    return auditBlocked("delegated_zone", policyResult.policyDigest)
  }

  const staticByHostname = new Map(
    policy.staticHosts.map((host) => [host.hostname, host] as const),
  )
  const managedHostnames = new Set(
    snapshot.managedAdvocateDomains.map((domain) => domain.hostname),
  )
  if (
    snapshot.managedAdvocateDomains.some((domain) =>
      staticByHostname.has(domain.hostname),
    )
  ) {
    return auditBlocked("managed_domain_conflict", policyResult.policyDigest)
  }
  const allowedHostnames = new Set([
    ...staticByHostname.keys(),
    ...managedHostnames,
  ])

  if (
    snapshot.cloudflareDnsRecords.some(
      (record) => !allowedHostnames.has(record.hostname),
    )
  ) {
    return auditBlocked("unknown_sibling", policyResult.policyDigest)
  }

  const dnsByHostname = new Map<string, CloudflareCookieTrustDnsRecord[]>()
  for (const record of snapshot.cloudflareDnsRecords) {
    const records = dnsByHostname.get(record.hostname) ?? []
    records.push(record)
    dnsByHostname.set(record.hostname, records)
  }
  for (const staticHost of policy.staticHosts) {
    const observed = dnsByHostname.get(staticHost.hostname)
    if (observed === undefined) {
      return auditBlocked("missing_sibling", policyResult.policyDigest)
    }
    if (!exactDnsRecords(staticHost.dnsRecords, observed)) {
      return auditBlocked(
        isSingleUnexpectedCname(staticHost.dnsRecords, observed)
          ? "unexpected_cname"
          : "unexpected_dns_records",
        policyResult.policyDigest,
      )
    }
  }

  const expectedAdvocateRecord: CookieTrustDnsRecord = {
    type: "CNAME",
    content: policy.advocateCnameTarget as string,
    proxied: false,
  }
  for (const hostname of managedHostnames) {
    const observed = dnsByHostname.get(hostname)
    if (observed === undefined) {
      return auditBlocked("missing_sibling", policyResult.policyDigest)
    }
    if (!exactDnsRecords([expectedAdvocateRecord], observed)) {
      return auditBlocked(
        observed.length === 1 && observed[0].type === "CNAME"
          ? "unexpected_cname"
          : "unexpected_dns_records",
        policyResult.policyDigest,
      )
    }
  }

  const attachmentByHostname = new Map(
    snapshot.vercelTeamDomainAttachments.map(
      (domain) => [domain.hostname, domain] as const,
    ),
  )
  const attachmentRequiredHostnames = new Set([
    ...policy.staticHosts
      .filter(staticDnsOwnerRequiresVercelAttachment)
      .map((host) => host.hostname),
    ...managedHostnames,
  ])
  if (
    snapshot.vercelTeamDomainAttachments.some(
      (domain) => !attachmentRequiredHostnames.has(domain.hostname),
    )
  ) {
    return auditBlocked("abandoned_attachment", policyResult.policyDigest)
  }

  for (const hostname of attachmentRequiredHostnames) {
    const attachment = attachmentByHostname.get(hostname)
    if (attachment === undefined) {
      return auditBlocked(
        "missing_vercel_attachment",
        policyResult.policyDigest,
      )
    }
    if (attachment.projectId !== policy.vercelProjectId) {
      return auditBlocked("vercel_project_mismatch", policyResult.policyDigest)
    }
    if (!attachment.verified) {
      return auditBlocked(
        "vercel_attachment_unverified",
        policyResult.policyDigest,
      )
    }
    if (
      attachment.redirectTarget !== null ||
      attachment.redirectStatusCode !== null ||
      attachment.gitBranch !== null ||
      attachment.customEnvironmentId !== null
    ) {
      return auditBlocked(
        "unexpected_vercel_attachment",
        policyResult.policyDigest,
      )
    }
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    state: "approved" as const,
    reason: "approved" as const,
    policyDigest: policyResult.policyDigest,
  })
}

export const COMMITTED_COOKIE_TRUST_POLICY: unknown = committedPolicy
export const COMMITTED_COOKIE_TRUST_POLICY_DIGEST = cookieTrustPolicyDigest(
  COMMITTED_COOKIE_TRUST_POLICY,
)
