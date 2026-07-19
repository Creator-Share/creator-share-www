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
const TARGET = "cname.vercel-dns.com"
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
