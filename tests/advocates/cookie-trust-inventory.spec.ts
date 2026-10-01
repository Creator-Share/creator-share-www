import { expect, test } from "@playwright/test"

import {
  COOKIE_TRUST_POLICY_DIGEST_ENVIRONMENT_VARIABLE,
  CROSS_SUBDOMAIN_COOKIE_MODE_ENVIRONMENT_VARIABLE,
  evaluateCrossSubdomainCookieTrustGate,
} from "../../src/lib/advocates/crossSubdomainAttributionGate"
import {
  COMMITTED_COOKIE_TRUST_POLICY,
  COMMITTED_COOKIE_TRUST_POLICY_DIGEST,
  cookieTrustPolicyDigest,
  evaluateCookieTrustAudit,
  evaluateCookieTrustPolicy,
  parseCookieTrustAuditSnapshot,
  parseCookieTrustPolicy,
  type VercelCookieTrustTeamDomainAttachment,
} from "../../src/lib/advocates/cookieTrustInventory"
import { getAdvocateAttributionIdentityCookieOptions } from "../../src/lib/advocates/attributionIdentityCookie"
import { getSponsorshipVisitorCookieOptions } from "../../src/lib/sponsorships/visitorCookieToken"

const CNAME_TARGET = "d1d4fc829fe7bc7c.vercel-dns-017.com"
const VERCEL_PROJECT_ID = "prj_cookieTrustProject123"

function approvedPolicy() {
  return {
    schemaVersion: 1,
    reviewState: "approved",
    tenantRoot: "creatorshare.com",
    policyRevision: "reviewed-2026-07-19",
    advocateCnameTarget: CNAME_TARGET,
    vercelProjectId: VERCEL_PROJECT_ID,
    staticHosts: [
      {
        hostname: "_acme-challenge.creatorshare.com",
        role: "static",
        dnsRecords: [
          {
            type: "CNAME",
            content: "validation.example.com",
            proxied: false,
          },
        ],
      },
      {
        hostname: "_dmarc.creatorshare.com",
        role: "static",
        dnsRecords: [
          { type: "TXT", content: "v=DMARC1; p=reject", proxied: false },
        ],
      },
      {
        hostname: "creatorshare.com",
        role: "primary",
        dnsRecords: [
          { type: "A", content: "76.76.21.21", proxied: false },
          { type: "NS", content: "ns1.cloudflare.com", proxied: false },
          { type: "TXT", content: "v=spf1 -all", proxied: false },
        ],
      },
      {
        hostname: "publication-sentinel.creatorshare.com",
        role: "sentinel",
        dnsRecords: [{ type: "CNAME", content: CNAME_TARGET, proxied: false }],
      },
      {
        hostname: "selector._domainkey.creatorshare.com",
        role: "static",
        dnsRecords: [
          { type: "TXT", content: "v=DKIM1; p=test", proxied: false },
        ],
      },
      {
        hostname: "www.creatorshare.com",
        role: "static",
        dnsRecords: [{ type: "CNAME", content: CNAME_TARGET, proxied: false }],
      },
    ],
  }
}

function verifiedAttachment(
  hostname: string,
): VercelCookieTrustTeamDomainAttachment {
  return {
    hostname,
    projectId: VERCEL_PROJECT_ID,
    verified: true,
    redirectTarget: null,
    redirectStatusCode: null,
    gitBranch: null,
    customEnvironmentId: null,
  }
}

function approvedSnapshot(policy = approvedPolicy()) {
  const policyDigest = cookieTrustPolicyDigest(policy)
  if (policyDigest === null) throw new Error("test_policy_invalid")
  return {
    schemaVersion: 1,
    policyDigest,
    sourceCompleteness: {
      cloudflareDnsRecords: "all_records_in_creator_share_tenant_zone",
      managedAdvocateDomains:
        "all_database_managed_domains_except_cleanup_verified",
      vercelTeamDomainAttachments:
        "all_creator_share_sibling_attachments_visible_to_owning_team",
    },
    cloudflareDnsRecords: [
      {
        hostname: "_acme-challenge.creatorshare.com",
        type: "CNAME",
        content: "validation.example.com",
        proxied: false,
      },
      {
        hostname: "_dmarc.creatorshare.com",
        type: "TXT",
        content: "v=DMARC1; p=reject",
        proxied: false,
      },
      {
        hostname: "creatorshare.com",
        type: "A",
        content: "76.76.21.21",
        proxied: false,
      },
      {
        hostname: "creatorshare.com",
        type: "NS",
        content: "ns1.cloudflare.com",
        proxied: false,
      },
      {
        hostname: "creatorshare.com",
        type: "TXT",
        content: "v=spf1 -all",
        proxied: false,
      },
      {
        hostname: "hope.creatorshare.com",
        type: "CNAME",
        content: CNAME_TARGET,
        proxied: false,
      },
      {
        hostname: "publication-sentinel.creatorshare.com",
        type: "CNAME",
        content: CNAME_TARGET,
        proxied: false,
      },
      {
        hostname: "selector._domainkey.creatorshare.com",
        type: "TXT",
        content: "v=DKIM1; p=test",
        proxied: false,
      },
      {
        hostname: "www.creatorshare.com",
        type: "CNAME",
        content: CNAME_TARGET,
        proxied: false,
      },
    ],
    vercelTeamDomainAttachments: [
      verifiedAttachment("creatorshare.com"),
      verifiedAttachment("hope.creatorshare.com"),
      verifiedAttachment("publication-sentinel.creatorshare.com"),
      verifiedAttachment("www.creatorshare.com"),
    ],
    managedAdvocateDomains: [
      { hostname: "hope.creatorshare.com", lifecycle: "active" },
    ],
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function sortSnapshot(snapshot: ReturnType<typeof approvedSnapshot>): void {
  snapshot.cloudflareDnsRecords.sort((left, right) => {
    const leftKey = `${left.hostname}\0${left.type}\0${left.content}\0${left.proxied ? "1" : "0"}`
    const rightKey = `${right.hostname}\0${right.type}\0${right.content}\0${right.proxied ? "1" : "0"}`
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })
  snapshot.vercelTeamDomainAttachments.sort((left, right) =>
    left.hostname.localeCompare(right.hostname),
  )
  snapshot.managedAdvocateDomains.sort((left, right) =>
    left.hostname.localeCompare(right.hostname),
  )
}

function productionEnvironment(digest: string | null): Record<string, string> {
  return {
    NODE_ENV: "production",
    [CROSS_SUBDOMAIN_COOKIE_MODE_ENVIRONMENT_VARIABLE]: "active",
    ...(digest === null
      ? {}
      : { [COOKIE_TRUST_POLICY_DIGEST_ENVIRONMENT_VARIABLE]: digest }),
  }
}

test("keeps the committed policy pending until provider evidence and ownership review exist", () => {
  expect(parseCookieTrustPolicy(COMMITTED_COOKIE_TRUST_POLICY)).toMatchObject({
    schemaVersion: 1,
    reviewState: "pending",
    tenantRoot: "creatorshare.com",
    advocateCnameTarget: null,
    vercelProjectId: null,
    staticHosts: [],
  })
  expect(COMMITTED_COOKIE_TRUST_POLICY_DIGEST).toMatch(/^[0-9a-f]{64}$/)
  expect(cookieTrustPolicyDigest(COMMITTED_COOKIE_TRUST_POLICY)).toBe(
    COMMITTED_COOKIE_TRUST_POLICY_DIGEST,
  )
  expect(evaluateCookieTrustPolicy(COMMITTED_COOKIE_TRUST_POLICY)).toEqual({
    schemaVersion: 1,
    state: "blocked",
    reason: "policy_pending",
    policyDigest: COMMITTED_COOKIE_TRUST_POLICY_DIGEST,
  })
})

test("strictly rejects expanded, unsorted, or incomplete policy and snapshots", () => {
  const expandedPolicy = { ...approvedPolicy(), ignored: true }
  const unsortedPolicy = clone(approvedPolicy())
  unsortedPolicy.staticHosts.reverse()
  const malformedPending = clone(approvedPolicy())
  malformedPending.reviewState = "pending"

  for (const value of [expandedPolicy, unsortedPolicy, malformedPending]) {
    expect(parseCookieTrustPolicy(value)).toBeNull()
    expect(evaluateCookieTrustPolicy(value)).toEqual({
      schemaVersion: 1,
      state: "blocked",
      reason: "policy_malformed",
      policyDigest: null,
    })
  }

  const incompleteSnapshot = clone(approvedSnapshot())
  incompleteSnapshot.sourceCompleteness.cloudflareDnsRecords = "partial"
  const duplicateAttachment = clone(approvedSnapshot())
  duplicateAttachment.vercelTeamDomainAttachments.splice(
    1,
    0,
    verifiedAttachment("creatorshare.com"),
  )
  expect(parseCookieTrustAuditSnapshot(incompleteSnapshot)).toBeNull()
  expect(parseCookieTrustAuditSnapshot(duplicateAttachment)).toBeNull()
})

test("approves exact HTTP hosts, nested service owners, and managed advocate facts", () => {
  const policy = approvedPolicy()
  const snapshot = approvedSnapshot(policy)
  expect(evaluateCookieTrustAudit(policy, snapshot)).toEqual({
    schemaVersion: 1,
    state: "approved",
    reason: "approved",
    policyDigest: cookieTrustPolicyDigest(policy),
  })
})

test("derives Vercel attachment requirements instead of trusting policy input", () => {
  const callerControlledOptOut = clone(approvedPolicy())
  const attemptedOptOut = callerControlledOptOut.staticHosts.find(
    (host) => host.hostname === "www.creatorshare.com",
  ) as Record<string, unknown>
  attemptedOptOut.requiresVercelAttachment = false
  expect(parseCookieTrustPolicy(callerControlledOptOut)).toBeNull()

  const missingStaticAttachment = clone(approvedSnapshot())
  missingStaticAttachment.vercelTeamDomainAttachments =
    missingStaticAttachment.vercelTeamDomainAttachments.filter(
      (attachment) => attachment.hostname !== "www.creatorshare.com",
    )
  expect(
    evaluateCookieTrustAudit(approvedPolicy(), missingStaticAttachment).reason,
  ).toBe("missing_vercel_attachment")
})

test("rejects proxied or nonexact HTTP routing even when Vercel is attached", () => {
  const proxied = clone(approvedPolicy())
  proxied.staticHosts.find(
    (host) => host.hostname === "www.creatorshare.com",
  )!.dnsRecords[0].proxied = true

  const wrongApex = clone(approvedPolicy())
  wrongApex.staticHosts.find(
    (host) => host.hostname === "creatorshare.com",
  )!.dnsRecords[0].content = "192.0.2.10"

  const alternateRouting = clone(approvedPolicy())
  const apexRecords = alternateRouting.staticHosts.find(
    (host) => host.hostname === "creatorshare.com",
  )!.dnsRecords
  apexRecords.push({
    type: "HTTPS",
    content: "1 . alpn=h2",
    proxied: false,
  })
  apexRecords.sort((left, right) => {
    const leftKey = `${left.type}\0${left.content}\0${left.proxied ? "1" : "0"}`
    const rightKey = `${right.type}\0${right.content}\0${right.proxied ? "1" : "0"}`
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })

  for (const policy of [proxied, wrongApex, alternateRouting]) {
    expect(parseCookieTrustPolicy(policy)).toBeNull()
    expect(evaluateCookieTrustPolicy(policy)).toMatchObject({
      state: "blocked",
      reason: "policy_malformed",
    })
  }
})

test("approves a newly managed exact advocate without changing committed policy", () => {
  const policy = approvedPolicy()
  const originalDigest = cookieTrustPolicyDigest(policy)
  const snapshot = clone(approvedSnapshot(policy))
  snapshot.managedAdvocateDomains.push({
    hostname: "newvoice.creatorshare.com",
    lifecycle: "active",
  })
  snapshot.cloudflareDnsRecords.push({
    hostname: "newvoice.creatorshare.com",
    type: "CNAME",
    content: CNAME_TARGET,
    proxied: false,
  })
  snapshot.vercelTeamDomainAttachments.push(
    verifiedAttachment("newvoice.creatorshare.com"),
  )
  sortSnapshot(snapshot)

  expect(cookieTrustPolicyDigest(policy)).toBe(originalDigest)
  expect(evaluateCookieTrustAudit(policy, snapshot)).toMatchObject({
    state: "approved",
    reason: "approved",
    policyDigest: originalDigest,
  })
})

test("approves nonactive managed domains while their provider topology remains attached", () => {
  const policy = approvedPolicy()
  for (const lifecycle of [
    "archive_quiescence",
    "failed_retained",
    "provisioning",
    "suspended",
    "verifying",
  ] as const) {
    const snapshot = clone(approvedSnapshot(policy))
    snapshot.managedAdvocateDomains[0].lifecycle = lifecycle
    expect(evaluateCookieTrustAudit(policy, snapshot)).toMatchObject({
      state: "approved",
      reason: "approved",
    })
  }

  const invalidLifecycle = clone(approvedSnapshot(policy))
  invalidLifecycle.managedAdvocateDomains[0].lifecycle = "cleanup_complete"
  expect(parseCookieTrustAuditSnapshot(invalidLifecycle)).toBeNull()
})

test("blocks unknown and wildcard siblings", () => {
  const policy = approvedPolicy()
  const unknownSibling = clone(approvedSnapshot(policy))
  unknownSibling.cloudflareDnsRecords.push({
    hostname: "legacy.creatorshare.com",
    type: "CNAME",
    content: CNAME_TARGET,
    proxied: false,
  })
  sortSnapshot(unknownSibling)
  expect(evaluateCookieTrustAudit(policy, unknownSibling).reason).toBe(
    "unknown_sibling",
  )

  const wildcard = clone(approvedSnapshot(policy))
  wildcard.cloudflareDnsRecords.push({
    hostname: "*.creatorshare.com",
    type: "CNAME",
    content: CNAME_TARGET,
    proxied: false,
  })
  sortSnapshot(wildcard)
  expect(evaluateCookieTrustAudit(policy, wildcard).reason).toBe(
    "wildcard_sibling",
  )
})

test("blocks delegated zones, unexpected CNAMEs, and extra address records", () => {
  const policy = approvedPolicy()
  const delegated = clone(approvedSnapshot(policy))
  delegated.cloudflareDnsRecords.push({
    hostname: "hope.creatorshare.com",
    type: "NS",
    content: "ns1.example.com",
    proxied: false,
  })
  sortSnapshot(delegated)
  expect(evaluateCookieTrustAudit(policy, delegated).reason).toBe(
    "delegated_zone",
  )

  const unexpectedCname = clone(approvedSnapshot(policy))
  const advocateCname = unexpectedCname.cloudflareDnsRecords.find(
    (record) => record.hostname === "hope.creatorshare.com",
  )
  if (advocateCname === undefined) throw new Error("Test CNAME missing")
  advocateCname.content = "unexpected.vercel-dns-017.com"
  expect(evaluateCookieTrustAudit(policy, unexpectedCname).reason).toBe(
    "unexpected_cname",
  )

  const extraAddress = clone(approvedSnapshot(policy))
  extraAddress.cloudflareDnsRecords.push({
    hostname: "hope.creatorshare.com",
    type: "A",
    content: "192.0.2.10",
    proxied: false,
  })
  sortSnapshot(extraAddress)
  expect(evaluateCookieTrustAudit(policy, extraAddress).reason).toBe(
    "unexpected_dns_records",
  )
})

test("blocks abandoned, mismatched, and unsafe Vercel attachments", () => {
  const policy = approvedPolicy()
  const abandoned = clone(approvedSnapshot(policy))
  abandoned.vercelTeamDomainAttachments.push(
    verifiedAttachment("legacy.creatorshare.com"),
  )
  sortSnapshot(abandoned)
  expect(evaluateCookieTrustAudit(policy, abandoned).reason).toBe(
    "abandoned_attachment",
  )

  const wrongProject = clone(approvedSnapshot(policy))
  wrongProject.vercelTeamDomainAttachments[1].projectId = "prj_wrongProject123"
  expect(evaluateCookieTrustAudit(policy, wrongProject).reason).toBe(
    "vercel_project_mismatch",
  )

  const branchBound = clone(approvedSnapshot(policy))
  branchBound.vercelTeamDomainAttachments[1].gitBranch = "preview"
  expect(evaluateCookieTrustAudit(policy, branchBound).reason).toBe(
    "unexpected_vercel_attachment",
  )

  const redirectBound = clone(approvedSnapshot(policy))
  redirectBound.vercelTeamDomainAttachments[1].redirectStatusCode = 308
  expect(evaluateCookieTrustAudit(policy, redirectBound).reason).toBe(
    "unexpected_vercel_attachment",
  )
})

test("blocks policy digest drift and missing managed domain facts", () => {
  const policy = approvedPolicy()
  const drift = clone(approvedSnapshot(policy))
  drift.policyDigest = "f".repeat(64)
  expect(evaluateCookieTrustAudit(policy, drift).reason).toBe("inventory_drift")

  const missingDns = clone(approvedSnapshot(policy))
  missingDns.cloudflareDnsRecords = missingDns.cloudflareDnsRecords.filter(
    (record) => record.hostname !== "hope.creatorshare.com",
  )
  expect(evaluateCookieTrustAudit(policy, missingDns).reason).toBe(
    "missing_sibling",
  )

  const missingAttachment = clone(approvedSnapshot(policy))
  missingAttachment.vercelTeamDomainAttachments.splice(1, 1)
  expect(evaluateCookieTrustAudit(policy, missingAttachment).reason).toBe(
    "missing_vercel_attachment",
  )
})

test("a static approved digest cannot activate production without a trusted live collector", () => {
  const policy = approvedPolicy()
  const digest = cookieTrustPolicyDigest(policy)
  expect(digest).not.toBeNull()
  expect(
    evaluateCrossSubdomainCookieTrustGate(
      productionEnvironment(digest),
      policy,
    ),
  ).toEqual({
    state: "host_only",
    reason: "trusted_collector_missing",
    policyDigest: digest,
  })

  const laterDnsDrift = clone(approvedSnapshot(policy))
  laterDnsDrift.cloudflareDnsRecords.push({
    hostname: "abandoned.creatorshare.com",
    type: "CNAME",
    content: CNAME_TARGET,
    proxied: false,
  })
  sortSnapshot(laterDnsDrift)
  expect(cookieTrustPolicyDigest(policy)).toBe(digest)
  expect(evaluateCookieTrustAudit(policy, laterDnsDrift).reason).toBe(
    "unknown_sibling",
  )

  for (const environment of [
    { NODE_ENV: "production" },
    {
      NODE_ENV: "production",
      [CROSS_SUBDOMAIN_COOKIE_MODE_ENVIRONMENT_VARIABLE]: "enabled",
      [COOKIE_TRUST_POLICY_DIGEST_ENVIRONMENT_VARIABLE]: digest as string,
    },
    {
      NODE_ENV: "production",
      [CROSS_SUBDOMAIN_COOKIE_MODE_ENVIRONMENT_VARIABLE]: "active",
    },
    {
      NODE_ENV: "production",
      [CROSS_SUBDOMAIN_COOKIE_MODE_ENVIRONMENT_VARIABLE]: "active",
      [COOKIE_TRUST_POLICY_DIGEST_ENVIRONMENT_VARIABLE]: "not-a-digest",
    },
    {
      ...productionEnvironment(digest),
      [COOKIE_TRUST_POLICY_DIGEST_ENVIRONMENT_VARIABLE]: "f".repeat(64),
    },
  ]) {
    expect(
      evaluateCrossSubdomainCookieTrustGate(environment, policy).state,
    ).toBe("host_only")
  }
})

test("production cookie options remain host only while the committed policy is pending", () => {
  const exactPendingEnvironment = productionEnvironment(
    COMMITTED_COOKIE_TRUST_POLICY_DIGEST,
  )
  for (const options of [
    getSponsorshipVisitorCookieOptions(
      "hope.creatorshare.com",
      false,
      exactPendingEnvironment,
    ),
    getAdvocateAttributionIdentityCookieOptions(
      "hope.creatorshare.com",
      false,
      exactPendingEnvironment,
    ),
  ]) {
    expect(options.domain).toBeUndefined()
    expect(options.secure).toBe(true)
    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe("lax")
  }
})

test("keeps every nonproduction runtime host only without an explicit test seam", () => {
  for (const options of [
    getSponsorshipVisitorCookieOptions("hope.creatorshare.com", false, {
      NODE_ENV: "test",
    }),
    getAdvocateAttributionIdentityCookieOptions(
      "hope.creatorshare.com",
      false,
      { NODE_ENV: "development" },
    ),
  ]) {
    expect(options.domain).toBeUndefined()
    expect(options.secure).toBe(true)
  }

  const digest = cookieTrustPolicyDigest(approvedPolicy())
  if (digest === null) throw new Error("Test policy invalid")
  for (const environment of [
    {},
    { NODE_ENV: "test" },
    { NODE_ENV: "development" },
    {
      NODE_ENV: "preview",
      [CROSS_SUBDOMAIN_COOKIE_MODE_ENVIRONMENT_VARIABLE]: "active",
      [COOKIE_TRUST_POLICY_DIGEST_ENVIRONMENT_VARIABLE]: digest,
    },
  ]) {
    expect(
      evaluateCrossSubdomainCookieTrustGate(environment, approvedPolicy()),
    ).toMatchObject({ state: "host_only" })
  }
})

test("allows parent cookies only through the explicit local test argument", () => {
  const localTestOptions = {
    unsafeAllowParentDomainCookiesForLocalTests: true as const,
  }
  expect(
    evaluateCrossSubdomainCookieTrustGate(
      { NODE_ENV: "test" },
      COMMITTED_COOKIE_TRUST_POLICY,
      localTestOptions,
    ),
  ).toMatchObject({
    state: "active",
    reason: "local_test_override",
  })
  expect(
    getSponsorshipVisitorCookieOptions(
      "hope.creatorshare.com",
      false,
      { NODE_ENV: "test" },
      undefined,
      localTestOptions,
    ).domain,
  ).toBe(".creatorshare.com")
  expect(
    evaluateCrossSubdomainCookieTrustGate(
      productionEnvironment(COMMITTED_COOKIE_TRUST_POLICY_DIGEST),
      COMMITTED_COOKIE_TRUST_POLICY,
      localTestOptions,
    ).state,
  ).toBe("host_only")
})
