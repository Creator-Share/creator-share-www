import { expect, test } from "@playwright/test"

import {
  ADVOCATE_TENANT_ROOT,
  RESERVED_ADVOCATE_SUBDOMAINS,
  resolveAdvocateHost,
} from "../../src/lib/advocates/host"

test.describe("advocate tenant host resolution", () => {
  test("returns an exact active-domain lookup for a production tenant candidate", () => {
    expect(resolveAdvocateHost("Alice.CreatorShare.com.")).toEqual({
      kind: "tenant-candidate",
      environment: "production",
      requestHostname: "alice.creatorshare.com",
      requestPort: null,
      tenantLabel: "alice",
      domainLookup: {
        hostname: "alice.creatorshare.com",
        requiredStatus: "active",
      },
    })
  })

  test("does not classify the tenant root as an advocate", () => {
    expect(resolveAdvocateHost(ADVOCATE_TENANT_ROOT)).toEqual({
      kind: "non-tenant",
      reason: "tenant-root",
      normalizedHostname: "creatorshare.com",
      port: null,
    })
  })

  test("keeps platform and infrastructure subdomains out of tenant lookup", () => {
    expect(new Set(RESERVED_ADVOCATE_SUBDOMAINS).size).toBe(
      RESERVED_ADVOCATE_SUBDOMAINS.length,
    )

    for (const label of RESERVED_ADVOCATE_SUBDOMAINS) {
      expect(resolveAdvocateHost(`${label}.creatorshare.com`)).toEqual({
        kind: "non-tenant",
        reason: "reserved-subdomain",
        normalizedHostname: `${label}.creatorshare.com`,
        port: null,
      })
    }
  })

  test("accepts only one label directly beneath the tenant root", () => {
    expect(resolveAdvocateHost("campaign.alice.creatorshare.com")).toEqual({
      kind: "non-tenant",
      reason: "nested-subdomain",
      normalizedHostname: "campaign.alice.creatorshare.com",
      port: null,
    })
  })

  test("never derives a tenant through loose suffix replacement", () => {
    for (const hostname of [
      "alicecreatorshare.com",
      "alice.creatorshare.com.evil.example",
      "creatorshare.com.evil.example",
      "alice.localhost.evil.example",
      "creator-share-www.vercel.app",
    ]) {
      expect(resolveAdvocateHost(hostname)).toEqual({
        kind: "non-tenant",
        reason: "outside-tenant-root",
        normalizedHostname: hostname,
        port: null,
      })
    }
  })

  test("rejects ports on production and unrelated hosts", () => {
    expect(resolveAdvocateHost("alice.creatorshare.com:443")).toEqual({
      kind: "invalid",
      reason: "port-not-allowed",
    })
    expect(resolveAdvocateHost("example.com:3000")).toEqual({
      kind: "invalid",
      reason: "port-not-allowed",
    })
  })

  test("maps an explicitly enabled localhost tenant to its exact production domain", () => {
    expect(
      resolveAdvocateHost("Alice.Localhost:3000", {
        allowLocalhostDevelopment: true,
      }),
    ).toEqual({
      kind: "tenant-candidate",
      environment: "local-development",
      requestHostname: "alice.localhost",
      requestPort: 3000,
      tenantLabel: "alice",
      domainLookup: {
        hostname: "alice.creatorshare.com",
        requiredStatus: "active",
      },
    })
  })

  test("denies localhost tenant inference unless the caller opts in", () => {
    expect(resolveAdvocateHost("alice.localhost:3000")).toEqual({
      kind: "non-tenant",
      reason: "local-development-disabled",
      normalizedHostname: "alice.localhost",
      port: 3000,
    })
  })

  test("does not classify localhost roots, reserved labels, or nested labels as tenants", () => {
    expect(
      resolveAdvocateHost("localhost:3000", {
        allowLocalhostDevelopment: true,
      }),
    ).toMatchObject({
      kind: "non-tenant",
      reason: "localhost-root",
    })

    expect(
      resolveAdvocateHost("admin.localhost:3000", {
        allowLocalhostDevelopment: true,
      }),
    ).toMatchObject({
      kind: "non-tenant",
      reason: "reserved-subdomain",
    })

    expect(
      resolveAdvocateHost("campaign.alice.localhost:3000", {
        allowLocalhostDevelopment: true,
      }),
    ).toMatchObject({
      kind: "non-tenant",
      reason: "nested-subdomain",
    })
  })

  test("keeps loopback addresses explicitly non-tenant", () => {
    expect(
      resolveAdvocateHost("127.0.0.1:3000", {
        allowLocalhostDevelopment: true,
      }),
    ).toMatchObject({
      kind: "non-tenant",
      reason: "loopback-address",
    })

    expect(
      resolveAdvocateHost("[::1]:3000", {
        allowLocalhostDevelopment: true,
      }),
    ).toMatchObject({
      kind: "non-tenant",
      reason: "loopback-address",
    })
  })

  test("rejects malformed ports", () => {
    for (const host of [
      "alice.localhost:0",
      "alice.localhost:03000",
      "alice.localhost:65536",
      "alice.localhost:abc",
      "alice.localhost:",
    ]) {
      expect(
        resolveAdvocateHost(host, { allowLocalhostDevelopment: true }),
      ).toEqual({
        kind: "invalid",
        reason:
          host.endsWith(":abc") || host.endsWith(":")
            ? "invalid-syntax"
            : "invalid-port",
      })
    }
  })

  test("rejects host-header injection and URL-shaped input", () => {
    const invalidHosts = [
      " alice.creatorshare.com",
      "alice.creatorshare.com ",
      "alice.creatorshare.com\nexample.com",
      "alice.creatorshare.com,example.com",
      "https://alice.creatorshare.com",
      "alice.creatorshare.com/path",
      "alice.creatorshare.com?query=1",
      "alice.creatorshare.com#fragment",
      "user@alice.creatorshare.com",
      "alice\\.creatorshare.com",
      "alice%2ecreatorshare.com",
      "älïce.creatorshare.com",
    ]

    for (const host of invalidHosts) {
      expect(resolveAdvocateHost(host).kind).toBe("invalid")
    }
  })

  test("rejects invalid DNS labels and missing hosts", () => {
    expect(resolveAdvocateHost(null)).toEqual({
      kind: "invalid",
      reason: "missing-host",
    })
    expect(resolveAdvocateHost(undefined)).toEqual({
      kind: "invalid",
      reason: "missing-host",
    })
    expect(resolveAdvocateHost("")).toEqual({
      kind: "invalid",
      reason: "missing-host",
    })

    for (const host of [
      "-alice.creatorshare.com",
      "alice-.creatorshare.com",
      "alice..creatorshare.com",
      `${"a".repeat(64)}.creatorshare.com`,
    ]) {
      expect(resolveAdvocateHost(host)).toEqual({
        kind: "invalid",
        reason: "invalid-hostname",
      })
    }
  })
})
