import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type RuntimeModule =
  typeof import("../../src/lib/advocates/publicationCanary/runtime")
type PublicationCanaryDnsResolver =
  import("../../src/lib/advocates/publicationCanary/runtime").PublicationCanaryDnsResolver
type PublicationCanaryHttpRequest =
  import("../../src/lib/advocates/publicationCanary/runner").PublicationCanaryHttpRequest
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  return originalModuleLoad.call(this, request, parent, isMain)
}
const testRequire = createRequire(
  resolve(process.cwd(), "tests/advocates/publication-canary-runtime.spec.ts"),
)
const runtime = testRequire(
  "../../src/lib/advocates/publicationCanary/runtime",
) as RuntimeModule
nodeModule._load = originalModuleLoad

const NOW = Date.parse("2026-07-18T18:00:00.000Z")
const HOSTNAME = "hope.creatorshare.com"
const SENTINEL_HOSTNAME = "publication-sentinel.creatorshare.com"
const SIBLING_HOSTNAME = "canary-0123456789abcdef.creatorshare.com"
const TARGET = "d1d4fc829fe7bc7c.vercel-dns-017.com"
const PINNED_ADDRESSES = Object.freeze([
  Object.freeze({ address: "76.76.21.21", family: 4 as const }),
])

function dnsResolver(options: {
  hostCnames?: string[]
  hostIpv4?: string[]
  hostIpv6?: string[]
  rejectCname?: boolean
}): PublicationCanaryDnsResolver & { cancelled: boolean } {
  return {
    cancelled: false,
    async resolveCname(hostname) {
      if (hostname !== HOSTNAME || options.rejectCname) {
        throw new Error("ENODATA")
      }
      return options.hostCnames ?? []
    },
    async resolve4(hostname) {
      return hostname === HOSTNAME ? (options.hostIpv4 ?? []) : []
    },
    async resolve6(hostname) {
      return hostname === HOSTNAME ? (options.hostIpv6 ?? []) : []
    },
    cancel() {
      this.cancelled = true
    },
  }
}

function dnsError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

function httpInput(
  overrides: Partial<PublicationCanaryHttpRequest> = {},
): PublicationCanaryHttpRequest {
  return {
    kind: "verifying_tenant_root",
    method: "GET",
    url: `https://${HOSTNAME}/`,
    hostname: HOSTNAME,
    headers: { Accept: "text/html, text/plain;q=0.9" },
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
    timeoutMs: 10_000,
    maxResponseBytes: 32_768,
    ...overrides,
  }
}

function httpResponse(
  input: PublicationCanaryHttpRequest,
  overrides: Partial<
    Awaited<ReturnType<RuntimeModule["requestPublicationCanaryHttp"]>>
  > = {},
) {
  return {
    requestedHostname: input.hostname,
    finalUrl: input.url,
    status: 404,
    redirected: false,
    contentType: "text/plain; charset=utf-8",
    body: new TextEncoder().encode("generic not found"),
    ...overrides,
  }
}

interface QueryResult {
  data: Record<string, unknown> | null
  error: { code: string } | null
}

function serviceClient(results: Record<string, QueryResult>) {
  const queried: Array<{ table: string; column: string; value: string }> = []
  return {
    queried,
    client: {
      from(table: string) {
        let filter = { column: "", value: "" }
        return {
          select() {
            return this
          },
          eq(column: string, value: string) {
            filter = { column, value }
            return this
          },
          limit() {
            return this
          },
          async maybeSingle() {
            queried.push({ table, ...filter })
            return results[table]
          },
        }
      },
    },
  }
}

test.describe("publication canary production runtime", () => {
  test("accepts only an exact production Vercel deployment identity", () => {
    const environment = {
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_DEPLOYMENT_ID: "dpl_1234567890abcdef",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
    }
    expect(
      runtime.loadPublicationCanaryDeploymentIdentity(environment),
    ).toEqual({
      deploymentId: environment.VERCEL_DEPLOYMENT_ID,
      revision: environment.VERCEL_GIT_COMMIT_SHA,
    })

    for (const invalid of [
      { ...environment, NODE_ENV: "development" },
      { ...environment, VERCEL: undefined },
      { ...environment, VERCEL_ENV: "preview" },
      { ...environment, VERCEL_DEPLOYMENT_ID: "deployment" },
      { ...environment, VERCEL_GIT_COMMIT_SHA: "A".repeat(40) },
    ]) {
      expect(() =>
        runtime.loadPublicationCanaryDeploymentIdentity(invalid),
      ).toThrow(runtime.PublicationCanaryRuntimeConfigurationError)
    }
  })

  test("proves the exact configured CNAME target and reports bounded DNS facts", async () => {
    const resolver = dnsResolver({
      hostCnames: [`${TARGET}.`],
      hostIpv4: ["76.76.21.21"],
    })
    let pinnedAddresses: readonly { address: string; family: 4 | 6 }[] = []
    await expect(
      runtime.observePublicationCanaryDns(
        { hostname: HOSTNAME, timeoutMs: 10_000 },
        {
          expectedCnameTarget: TARGET,
          resolverFactory: () => resolver,
          now: () => NOW,
          onPinnedAddresses(addresses) {
            pinnedAddresses = addresses
          },
        },
      ),
    ).resolves.toEqual({
      hostname: HOSTNAME,
      resolved: true,
      providerTargetMatched: true,
      recordTypes: ["CNAME", "A"],
      answerCount: 2,
      observedAt: "2026-07-18T18:00:00.000Z",
    })
    expect(pinnedAddresses).toEqual(PINNED_ADDRESSES)
    expect(resolver.cancelled).toBe(false)
  })

  test("rejects flattening, unexpected CNAMEs, and unsafe pinned addresses", async () => {
    await expect(
      runtime.observePublicationCanaryDns(
        { hostname: HOSTNAME, timeoutMs: 10_000 },
        {
          expectedCnameTarget: TARGET,
          resolverFactory: () =>
            dnsResolver({
              rejectCname: true,
              hostIpv4: ["76.76.21.21"],
              hostIpv6: ["2606:4700::6810:1"],
            }),
          now: () => NOW,
        },
      ),
    ).rejects.toThrow("publication_canary_dns_target_mismatch")

    await expect(
      runtime.observePublicationCanaryDns(
        { hostname: HOSTNAME, timeoutMs: 10_000 },
        {
          expectedCnameTarget: TARGET,
          resolverFactory: () =>
            dnsResolver({
              hostCnames: [TARGET, "attacker.example"],
              hostIpv4: ["76.76.21.21"],
            }),
        },
      ),
    ).rejects.toThrow("publication_canary_dns_target_mismatch")

    for (const unsafeAddress of [
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "192.0.2.1",
    ]) {
      await expect(
        runtime.observePublicationCanaryDns(
          { hostname: HOSTNAME, timeoutMs: 10_000 },
          {
            expectedCnameTarget: TARGET,
            resolverFactory: () =>
              dnsResolver({
                hostCnames: [TARGET],
                hostIpv4: [unsafeAddress],
              }),
          },
        ),
      ).rejects.toThrow("publication_canary_dns_target_mismatch")
    }
  })

  test("rejects unsafe IPv6 pinned addresses", async () => {
    // The unsafe-address coverage above is IPv4 only. A mutation removing the
    // IPv6 global-unicast restriction therefore left the suite green, which
    // would let a tenant AAAA record pin an internal address. The canary
    // worker dials pinned addresses holding a service-role client and a live
    // challenge bearer, so that turns it into an SSRF probe against private
    // network space, and a succeeded report could be produced by an
    // attacker-controlled internal host.
    for (const unsafeAddress of [
      "fd00::1", // unique local
      "fe80::1", // link local
      "::1", // loopback
      "::ffff:169.254.169.254", // IPv4-mapped cloud metadata
      "2001:db8::1", // documentation, explicitly excluded
      "2002::1", // 6to4, explicitly excluded
      "ff02::1", // multicast
      "fc00::1", // unique local, lower half
    ]) {
      await expect(
        runtime.observePublicationCanaryDns(
          { hostname: HOSTNAME, timeoutMs: 10_000 },
          {
            expectedCnameTarget: TARGET,
            resolverFactory: () =>
              dnsResolver({
                hostCnames: [TARGET],
                hostIpv6: [unsafeAddress],
              }),
            now: () => NOW,
          },
        ),
        `${unsafeAddress} must not be accepted as a pinned address`,
      ).rejects.toThrow("publication_canary_dns_target_mismatch")
    }
  })

  test("accepts a global unicast IPv6 pinned address", async () => {
    // The negative cases above would all pass if the predicate rejected every
    // IPv6 address, so the boundary is asserted from both sides.
    const pinned: unknown[] = []
    const observation = await runtime.observePublicationCanaryDns(
      { hostname: HOSTNAME, timeoutMs: 10_000 },
      {
        expectedCnameTarget: TARGET,
        resolverFactory: () =>
          dnsResolver({
            hostCnames: [TARGET],
            hostIpv6: ["2606:4700::6810:1"],
          }),
        now: () => NOW,
        onPinnedAddresses: (addresses) => pinned.push(...addresses),
      },
    )

    expect(observation.resolved).toBe(true)
    expect(pinned).toEqual([{ address: "2606:4700::6810:1", family: 6 }])
  })

  test("proves random sibling DNS absence only from empty answers or exact absence codes", async () => {
    const aliasQueries: string[] = []
    const resolver: PublicationCanaryDnsResolver = {
      async resolveCname() {
        throw dnsError("ENODATA")
      },
      async resolve4() {
        return []
      },
      async resolve6() {
        throw dnsError("ENOTFOUND")
      },
      cancel() {},
    }
    await expect(
      runtime.observeUnprovisionedSiblingDnsAbsence(
        { hostname: SIBLING_HOSTNAME, timeoutMs: 10_000 },
        {
          resolverFactory: () => resolver,
          async aliasAbsenceResolver(input) {
            aliasQueries.push(input.recordType)
            return true
          },
          now: () => NOW,
        },
      ),
    ).resolves.toEqual({
      hostname: SIBLING_HOSTNAME,
      resolved: false,
      recordTypes: [],
      answerCount: 0,
      observedAt: "2026-07-18T18:00:00.000Z",
    })
    expect(aliasQueries.sort()).toEqual(["HTTPS", "SVCB"])
  })

  test("fails strict sibling absence when HTTPS or SVCB records exist", async () => {
    for (const presentType of ["HTTPS", "SVCB"] as const) {
      await expect(
        runtime.observeUnprovisionedSiblingDnsAbsence(
          { hostname: SIBLING_HOSTNAME, timeoutMs: 10_000 },
          {
            resolverFactory: () => ({
              async resolveCname() {
                return []
              },
              async resolve4() {
                return []
              },
              async resolve6() {
                return []
              },
              cancel() {},
            }),
            async aliasAbsenceResolver(input) {
              return input.recordType !== presentType
            },
          },
        ),
      ).rejects.toThrow("publication_canary_sibling_dns_absence_inconclusive")
    }
  })

  test("validates exact HTTPS and SVCB DNS-over-HTTPS absence responses", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImplementation = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = new URL(String(input))
      calls.push({ url: url.toString(), init })
      const type = Number(url.searchParams.get("type"))
      return new Response(
        JSON.stringify({
          Status: 0,
          TC: false,
          Question: [{ name: `${SIBLING_HOSTNAME}.`, type }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        },
      )
    }) as typeof fetch

    for (const recordType of ["SVCB", "HTTPS"] as const) {
      await expect(
        runtime.queryPublicationCanaryDnsAliasAbsence(
          { hostname: SIBLING_HOSTNAME, recordType, timeoutMs: 10_000 },
          { fetchImplementation },
        ),
      ).resolves.toBe(true)
    }
    expect(
      calls.map(({ url }) => new URL(url).searchParams.get("type")),
    ).toEqual(["64", "65"])
    for (const call of calls) {
      expect(call.init).toMatchObject({
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      })
      expect((call.init?.headers as Record<string, string>).Accept).toBe(
        "application/dns-json",
      )
    }
  })

  test("reserves settlement time and refuses late sentinel network work", async () => {
    const dependencies =
      runtime.createPublicationCanarySentinelBootstrapRuntimeDependencies({
        deadlineAtMilliseconds: 50_000,
        monotonicNow: () => 40_001,
      })

    await expect(dependencies.observeDns()).rejects.toThrow(
      "publication_canary_sentinel_deadline_exhausted",
    )
  })

  test("treats records, resolver faults, malformed answers, and timeouts as inconclusive absence", async () => {
    const scenarios: Array<() => PublicationCanaryDnsResolver> = [
      () => ({
        async resolveCname() {
          return [TARGET]
        },
        async resolve4() {
          return []
        },
        async resolve6() {
          return []
        },
        cancel() {},
      }),
      () => ({
        async resolveCname() {
          throw dnsError("SERVFAIL")
        },
        async resolve4() {
          return []
        },
        async resolve6() {
          return []
        },
        cancel() {},
      }),
      () => ({
        async resolveCname() {
          return []
        },
        async resolve4() {
          throw dnsError("REFUSED")
        },
        async resolve6() {
          return []
        },
        cancel() {},
      }),
      () => ({
        async resolveCname() {
          throw new Error("ENODATA")
        },
        async resolve4() {
          return []
        },
        async resolve6() {
          return []
        },
        cancel() {},
      }),
      () => ({
        async resolveCname() {
          return []
        },
        async resolve4() {
          return ["not-an-ip"]
        },
        async resolve6() {
          return []
        },
        cancel() {},
      }),
    ]

    for (const resolverFactory of scenarios) {
      await expect(
        runtime.observeUnprovisionedSiblingDnsAbsence(
          { hostname: SIBLING_HOSTNAME, timeoutMs: 10_000 },
          {
            resolverFactory,
            aliasAbsenceResolver: async () => true,
          },
        ),
      ).rejects.toThrow()
    }

    let cancelled = false
    const never = new Promise<string[]>(() => {})
    await expect(
      runtime.observeUnprovisionedSiblingDnsAbsence(
        { hostname: SIBLING_HOSTNAME, timeoutMs: 100 },
        {
          resolverFactory: () => ({
            resolveCname: () => never,
            resolve4: () => never,
            resolve6: () => never,
            cancel() {
              cancelled = true
            },
          }),
          aliasAbsenceResolver: async () => true,
        },
      ),
    ).rejects.toThrow("publication_canary_dns_timeout")
    expect(cancelled).toBe(true)
  })

  test("requires normal authorized TLS and a matching live certificate", async () => {
    const input = {
      hostname: HOSTNAME,
      serverName: HOSTNAME,
      rejectUnauthorized: true as const,
      timeoutMs: 10_000,
    }
    await expect(
      runtime.inspectPublicationCanaryTls(input, {
        now: () => NOW,
        connect: async () => ({
          authorized: true,
          authorizationErrorPresent: false,
          hostnameMatched: true,
          protocol: "TLSv1.3",
          certificateNotBefore: "2026-07-01T00:00:00.000Z",
          certificateNotAfter: "2026-08-01T00:00:00.000Z",
        }),
      }),
    ).resolves.toEqual({
      hostname: HOSTNAME,
      serverName: HOSTNAME,
      certificateVerified: true,
      hostnameMatched: true,
      normalCertificateVerification: true,
      protocol: "TLSv1.3",
      certificateNotBefore: "2026-07-01T00:00:00.000Z",
      certificateNotAfter: "2026-08-01T00:00:00.000Z",
      observedAt: "2026-07-18T18:00:00.000Z",
    })

    for (const override of [
      { authorized: false },
      { authorizationErrorPresent: true },
      { hostnameMatched: false },
      { protocol: "TLSv1.1" },
      { certificateNotAfter: "2026-07-18T18:00:00.000Z" },
    ]) {
      await expect(
        runtime.inspectPublicationCanaryTls(input, {
          now: () => NOW,
          connect: async () => ({
            authorized: true,
            authorizationErrorPresent: false,
            hostnameMatched: true,
            protocol: "TLSv1.3",
            certificateNotBefore: "2026-07-01T00:00:00.000Z",
            certificateNotAfter: "2026-08-01T00:00:00.000Z",
            ...override,
          }),
        }),
      ).rejects.toThrow("publication_canary_tls_verification_failed")
    }
  })

  test("performs exact no-redirect HTTP requests and streams bounded bodies", async () => {
    const calls: Array<{
      input: PublicationCanaryHttpRequest
      addresses: readonly { address: string; family: 4 | 6 }[]
    }> = []
    const input = httpInput()
    const result = await runtime.requestPublicationCanaryHttp(input, {
      pinnedAddresses: PINNED_ADDRESSES,
      async transport(transportInput, addresses) {
        calls.push({ input: transportInput, addresses })
        return httpResponse(transportInput)
      },
    })
    expect(result).toMatchObject({
      requestedHostname: HOSTNAME,
      finalUrl: `https://${HOSTNAME}/`,
      status: 404,
      redirected: false,
      contentType: "text/plain; charset=utf-8",
    })
    expect(new TextDecoder().decode(result.body)).toBe("generic not found")
    expect(calls).toEqual([{ input, addresses: PINNED_ADDRESSES }])
  })

  test("keeps tenant and sentinel DNS pins independent for TLS and HTTPS", async () => {
    const addresses = new Map([
      [HOSTNAME, "76.76.21.21"],
      [SENTINEL_HOSTNAME, "76.76.21.22"],
    ])
    const tlsPins: Array<{ hostname: string; address: string }> = []
    const httpPins: Array<{ hostname: string; address: string }> = []
    const environment = {
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_DEPLOYMENT_ID: "dpl_1234567890abcdef",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
      ADVOCATE_CLOUDFLARE_API_TOKEN: "cloudflare-token-value-1234567890",
      ADVOCATE_CLOUDFLARE_ZONE_ID: "b".repeat(32),
      ADVOCATE_CLOUDFLARE_CNAME_TARGET: TARGET,
    }
    const dependencies = runtime.createPublicationCanaryRuntimeDependencies({
      serviceRoleClient: {} as never,
      environment,
      deploymentIdentity: {
        deploymentId: environment.VERCEL_DEPLOYMENT_ID,
        revision: environment.VERCEL_GIT_COMMIT_SHA,
      },
      now: () => NOW,
      resolverFactory: () => ({
        async resolveCname() {
          return [TARGET]
        },
        async resolve4(hostname) {
          return [addresses.get(hostname) ?? "10.0.0.1"]
        },
        async resolve6() {
          return []
        },
        cancel() {},
      }),
      async connectPinnedTls(input, pins) {
        tlsPins.push({ hostname: input.hostname, address: pins[0].address })
        return {
          authorized: true,
          authorizationErrorPresent: false,
          hostnameMatched: true,
          protocol: "TLSv1.3",
          certificateNotBefore: "2026-07-01T00:00:00.000Z",
          certificateNotAfter: "2026-08-01T00:00:00.000Z",
        }
      },
      async httpTransport(input, pins) {
        httpPins.push({ hostname: input.hostname, address: pins[0].address })
        return httpResponse(input)
      },
    })

    for (const hostname of [HOSTNAME, SENTINEL_HOSTNAME]) {
      await dependencies.observeDns({ hostname, timeoutMs: 10_000 })
      await dependencies.inspectTls({
        hostname,
        serverName: hostname,
        rejectUnauthorized: true,
        timeoutMs: 10_000,
      })
      await dependencies.requestHttp(
        httpInput(
          hostname === SENTINEL_HOSTNAME
            ? {
                kind: "negative_sentinel_root",
                hostname,
                url: `https://${hostname}/`,
              }
            : {},
        ),
      )
    }

    expect(tlsPins).toEqual([
      { hostname: HOSTNAME, address: "76.76.21.21" },
      { hostname: SENTINEL_HOSTNAME, address: "76.76.21.22" },
    ])
    expect(httpPins).toEqual(tlsPins)
  })

  test("rejects request mutation, redirects, and oversized response bodies", async () => {
    await expect(
      runtime.requestPublicationCanaryHttp(
        httpInput({ url: "https://attacker.example/" }),
        {
          pinnedAddresses: PINNED_ADDRESSES,
          transport: async (input) => httpResponse(input),
        },
      ),
    ).rejects.toThrow("publication_canary_http_input_invalid")

    await expect(
      runtime.requestPublicationCanaryHttp(httpInput(), {
        pinnedAddresses: PINNED_ADDRESSES,
        transport: async (input) =>
          httpResponse(input, {
            finalUrl: "https://other.creatorshare.com/",
            redirected: true,
          }),
      }),
    ).rejects.toThrow("publication_canary_http_response_invalid")

    await expect(
      runtime.requestPublicationCanaryHttp(httpInput({ maxResponseBytes: 4 }), {
        pinnedAddresses: PINNED_ADDRESSES,
        transport: async (input) =>
          httpResponse(input, { body: new TextEncoder().encode("12345") }),
      }),
    ).rejects.toThrow("publication_canary_http_response_invalid")
  })

  test("treats exact domains and reserved labels as provisioned siblings", async () => {
    const domain = serviceClient({
      advocate_domains: { data: { id: "domain" }, error: null },
      advocate_reserved_subdomains: { data: null, error: null },
    })
    await expect(
      runtime.isPublicationCanaryHostnameProvisioned(
        domain.client as never,
        HOSTNAME,
      ),
    ).resolves.toBe(true)
    expect(domain.queried).toEqual([
      { table: "advocate_domains", column: "hostname", value: HOSTNAME },
    ])

    const reserved = serviceClient({
      advocate_domains: { data: null, error: null },
      advocate_reserved_subdomains: { data: { label: "hope" }, error: null },
    })
    await expect(
      runtime.isPublicationCanaryHostnameProvisioned(
        reserved.client as never,
        HOSTNAME,
      ),
    ).resolves.toBe(true)
    expect(reserved.queried[1]).toEqual({
      table: "advocate_reserved_subdomains",
      column: "label",
      value: "hope",
    })

    const available = serviceClient({
      advocate_domains: { data: null, error: null },
      advocate_reserved_subdomains: { data: null, error: null },
    })
    await expect(
      runtime.isPublicationCanaryHostnameProvisioned(
        available.client as never,
        HOSTNAME,
      ),
    ).resolves.toBe(false)
  })
})
