import "server-only"

import { Resolver } from "node:dns/promises"
import { request as requestHttps } from "node:https"
import { BlockList, isIP, type LookupFunction } from "node:net"
import {
  checkServerIdentity,
  connect as connectTls,
  type PeerCertificate,
} from "node:tls"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  loadCloudflareProvisioningConfig,
  loadPublicationPaymentCanaryConfig,
  type ProvisioningEnvironment,
} from "../provisioning/config"
import {
  runPayPalPublicationPaymentCanary,
  runStripePublicationPaymentCanary,
} from "../provisioning/paymentCanaries"
import { resolveAdvocateHost } from "../host"
import {
  ADVOCATE_PUBLICATION_CANARY_PATH,
  createPublicationCanaryToken,
  verifyPublicationCanaryResponse,
  verifyPublicationCanaryToken,
} from "./challenge"
import type {
  PublicationCanaryDnsObservation,
  PublicationCanaryHttpRequest,
  PublicationCanaryHttpResponse,
  PublicationCanaryRunnerDependencies,
  PublicationCanaryTlsObservation,
} from "./runner"

const DEPLOYMENT_ID_PATTERN = /^dpl_[A-Za-z0-9]{8,128}$/
const REVISION_PATTERN = /^[0-9a-f]{40}$/
const DNS_HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const SAFE_HEADER_VALUE_PATTERN = /^[\x20-\x7e]{1,4096}$/
const SAFE_CONTENT_TYPE_PATTERN = /^[\x20-\x7e]{1,200}$/
const MAXIMUM_NETWORK_TIMEOUT_MS = 60_000
const MINIMUM_NETWORK_TIMEOUT_MS = 100
const MAXIMUM_HTTP_RESPONSE_BYTES = 65_536
const MAXIMUM_HTTP_RESPONSE_HEADERS_BYTES = 16_384

const UNSAFE_IPV4_RANGES = new BlockList()
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  UNSAFE_IPV4_RANGES.addSubnet(network, prefix, "ipv4")
}

export interface PublicationCanaryDeploymentIdentity {
  deploymentId: string
  revision: string
}

export class PublicationCanaryRuntimeConfigurationError extends Error {
  constructor() {
    super("advocate_publication_canary_runtime_configuration_unavailable")
    this.name = "PublicationCanaryRuntimeConfigurationError"
  }
}

function configurationError(): never {
  throw new PublicationCanaryRuntimeConfigurationError()
}

function isExactProductionAdvocateHostname(value: string): boolean {
  const resolution = resolveAdvocateHost(value)
  return (
    resolution.kind === "tenant-candidate" &&
    resolution.environment === "production" &&
    resolution.requestHostname === value &&
    resolution.requestPort === null &&
    resolution.domainLookup.hostname === value
  )
}

function assertNetworkTimeout(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < MINIMUM_NETWORK_TIMEOUT_MS ||
    value > MAXIMUM_NETWORK_TIMEOUT_MS
  ) {
    throw new Error("publication_canary_network_input_invalid")
  }
}

function currentTimestamp(now: () => number): string {
  const value = now()
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("publication_canary_clock_unavailable")
  }
  return new Date(value).toISOString()
}

export function loadPublicationCanaryDeploymentIdentity(
  environment: ProvisioningEnvironment = process.env,
): PublicationCanaryDeploymentIdentity {
  const deploymentId = environment.VERCEL_DEPLOYMENT_ID
  const revision = environment.VERCEL_GIT_COMMIT_SHA
  if (
    environment.NODE_ENV !== "production" ||
    environment.VERCEL !== "1" ||
    environment.VERCEL_ENV !== "production" ||
    typeof deploymentId !== "string" ||
    !DEPLOYMENT_ID_PATTERN.test(deploymentId) ||
    typeof revision !== "string" ||
    !REVISION_PATTERN.test(revision)
  ) {
    configurationError()
  }
  return Object.freeze({ deploymentId, revision })
}

export interface PublicationCanaryDnsResolver {
  resolveCname(hostname: string): Promise<string[]>
  resolve4(hostname: string): Promise<string[]>
  resolve6(hostname: string): Promise<string[]>
  cancel(): void
}

export type PublicationCanaryDnsResolverFactory =
  () => PublicationCanaryDnsResolver

export interface PublicationCanaryPinnedAddress {
  address: string
  family: 4 | 6
}

interface DnsQueryResult {
  hostCnames: string[]
  hostIpv4: string[]
  hostIpv6: string[]
}

function normalizeDnsHostname(value: string): string | null {
  const normalized = value.toLowerCase().replace(/\.$/, "")
  return DNS_HOSTNAME_PATTERN.test(normalized) ? normalized : null
}

function fulfilledStrings(
  result: PromiseSettledResult<string[]>,
  kind: "cname" | "ipv4" | "ipv6",
): string[] {
  if (result.status === "rejected") return []
  if (!Array.isArray(result.value) || result.value.length > 1_000) {
    throw new Error("publication_canary_dns_response_invalid")
  }

  const normalized = result.value.map((value) => {
    if (typeof value !== "string") {
      throw new Error("publication_canary_dns_response_invalid")
    }
    if (kind === "cname") {
      const hostname = normalizeDnsHostname(value)
      if (hostname === null) {
        throw new Error("publication_canary_dns_response_invalid")
      }
      return hostname
    }
    if (isIP(value) !== (kind === "ipv4" ? 4 : 6)) {
      throw new Error("publication_canary_dns_response_invalid")
    }
    return value.toLowerCase()
  })
  return [...new Set(normalized)].sort()
}

async function runDnsQueries(
  resolver: PublicationCanaryDnsResolver,
  hostname: string,
  timeoutMs: number,
): Promise<DnsQueryResult> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const queries = Promise.allSettled([
    resolver.resolveCname(hostname),
    resolver.resolve4(hostname),
    resolver.resolve6(hostname),
  ])
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      try {
        resolver.cancel()
      } catch {
        // Cancellation is best effort after the bounded deadline.
      }
      reject(new Error("publication_canary_dns_timeout"))
    }, timeoutMs)
    timeout.unref?.()
  })

  try {
    const results = await Promise.race([queries, timedOut])
    return {
      hostCnames: fulfilledStrings(results[0], "cname"),
      hostIpv4: fulfilledStrings(results[1], "ipv4"),
      hostIpv6: fulfilledStrings(results[2], "ipv6"),
    }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

function isAllowedPublicAddress(address: string, family: 4 | 6): boolean {
  if (isIP(address) !== family) return false
  if (family === 4) return !UNSAFE_IPV4_RANGES.check(address, "ipv4")

  const firstHextet = Number.parseInt(address.split(":", 1)[0] ?? "", 16)
  return (
    Number.isSafeInteger(firstHextet) &&
    firstHextet >= 0x2000 &&
    firstHextet <= 0x3fff &&
    !address.toLowerCase().startsWith("2001:db8:") &&
    !address.toLowerCase().startsWith("2002:")
  )
}

export async function observePublicationCanaryDns(
  input: { hostname: string; timeoutMs: number },
  options: {
    expectedCnameTarget: string
    resolverFactory?: PublicationCanaryDnsResolverFactory
    now?: () => number
    onPinnedAddresses?: (
      addresses: readonly PublicationCanaryPinnedAddress[],
    ) => void
  },
): Promise<PublicationCanaryDnsObservation> {
  assertNetworkTimeout(input.timeoutMs)
  if (!isExactProductionAdvocateHostname(input.hostname)) {
    throw new Error("publication_canary_dns_input_invalid")
  }
  const expectedTarget = normalizeDnsHostname(options.expectedCnameTarget)
  if (
    expectedTarget === null ||
    expectedTarget !== options.expectedCnameTarget.toLowerCase()
  ) {
    throw new Error("publication_canary_dns_input_invalid")
  }

  const resolver = (options.resolverFactory ?? (() => new Resolver()))()
  const result = await runDnsQueries(resolver, input.hostname, input.timeoutMs)
  const recordTypes = [
    ...(result.hostCnames.length > 0 ? (["CNAME"] as const) : []),
    ...(result.hostIpv4.length > 0 ? (["A"] as const) : []),
    ...(result.hostIpv6.length > 0 ? (["AAAA"] as const) : []),
  ]
  const answerCount =
    result.hostCnames.length + result.hostIpv4.length + result.hostIpv6.length
  const pinnedAddresses = [
    ...result.hostIpv4.map((address) => ({ address, family: 4 as const })),
    ...result.hostIpv6.map((address) => ({ address, family: 6 as const })),
  ]
  if (
    result.hostCnames.length !== 1 ||
    result.hostCnames[0] !== expectedTarget ||
    pinnedAddresses.length < 1 ||
    !pinnedAddresses.every(({ address, family }) =>
      isAllowedPublicAddress(address, family),
    ) ||
    recordTypes.length === 0 ||
    answerCount < 2
  ) {
    throw new Error("publication_canary_dns_target_mismatch")
  }
  options.onPinnedAddresses?.(
    Object.freeze(pinnedAddresses.map((value) => Object.freeze(value))),
  )

  return {
    hostname: input.hostname,
    resolved: true,
    providerTargetMatched: true,
    recordTypes,
    answerCount,
    observedAt: currentTimestamp(options.now ?? Date.now),
  }
}

export interface PublicationCanaryRawTlsObservation {
  authorized: boolean
  authorizationErrorPresent: boolean
  hostnameMatched: boolean
  protocol: string | null
  certificateNotBefore: string
  certificateNotAfter: string
}

export type PublicationCanaryTlsConnector = (input: {
  hostname: string
  serverName: string
  rejectUnauthorized: true
  timeoutMs: number
}) => Promise<PublicationCanaryRawTlsObservation>

function certificateHostnameMatches(
  hostname: string,
  certificate: PeerCertificate,
): boolean {
  try {
    return checkServerIdentity(hostname, certificate) === undefined
  } catch {
    return false
  }
}

async function connectPublicationCanaryTlsAddress(
  input: Parameters<PublicationCanaryTlsConnector>[0],
  pinnedAddress: PublicationCanaryPinnedAddress,
): Promise<PublicationCanaryRawTlsObservation> {
  return new Promise((resolve, reject) => {
    let settled = false
    const socket = connectTls({
      host: pinnedAddress.address,
      port: 443,
      servername: input.serverName,
      rejectUnauthorized: input.rejectUnauthorized,
      minVersion: "TLSv1.2",
    })

    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(wallTimeout)
      socket.destroy()
      reject(error)
    }
    const wallTimeout = setTimeout(
      () => fail(new Error("publication_canary_tls_timeout")),
      input.timeoutMs,
    )
    wallTimeout.unref?.()
    socket.once("error", fail)
    socket.once("secureConnect", () => {
      if (settled) return
      try {
        const certificate = socket.getPeerCertificate()
        const result: PublicationCanaryRawTlsObservation = {
          authorized: socket.authorized,
          authorizationErrorPresent: socket.authorizationError != null,
          hostnameMatched: certificateHostnameMatches(
            input.hostname,
            certificate,
          ),
          protocol: socket.getProtocol(),
          certificateNotBefore: certificate.valid_from,
          certificateNotAfter: certificate.valid_to,
        }
        settled = true
        clearTimeout(wallTimeout)
        socket.destroy()
        resolve(result)
      } catch (error) {
        fail(error)
      }
    })
  })
}

export async function connectPinnedPublicationCanaryTls(
  input: Parameters<PublicationCanaryTlsConnector>[0],
  pinnedAddresses: readonly PublicationCanaryPinnedAddress[],
): Promise<PublicationCanaryRawTlsObservation> {
  if (
    pinnedAddresses.length < 1 ||
    !pinnedAddresses.every(({ address, family }) =>
      isAllowedPublicAddress(address, family),
    )
  ) {
    throw new Error("publication_canary_tls_pin_invalid")
  }

  const deadline = Date.now() + input.timeoutMs
  let lastError: unknown = new Error("publication_canary_tls_unavailable")
  for (const pinnedAddress of pinnedAddresses) {
    const remaining = deadline - Date.now()
    if (remaining < MINIMUM_NETWORK_TIMEOUT_MS) break
    try {
      return await connectPublicationCanaryTlsAddress(
        { ...input, timeoutMs: remaining },
        pinnedAddress,
      )
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

export async function inspectPublicationCanaryTls(
  input: {
    hostname: string
    serverName: string
    rejectUnauthorized: true
    timeoutMs: number
  },
  options: {
    connect: PublicationCanaryTlsConnector
    now?: () => number
  },
): Promise<PublicationCanaryTlsObservation> {
  assertNetworkTimeout(input.timeoutMs)
  if (
    !isExactProductionAdvocateHostname(input.hostname) ||
    input.serverName !== input.hostname ||
    input.rejectUnauthorized !== true
  ) {
    throw new Error("publication_canary_tls_input_invalid")
  }

  const raw = await options.connect(input)
  const observedAt = currentTimestamp(options.now ?? Date.now)
  const notBeforeMilliseconds = Date.parse(raw.certificateNotBefore)
  const notAfterMilliseconds = Date.parse(raw.certificateNotAfter)
  const observedMilliseconds = Date.parse(observedAt)
  if (
    raw.authorized !== true ||
    raw.authorizationErrorPresent !== false ||
    raw.hostnameMatched !== true ||
    (raw.protocol !== "TLSv1.2" && raw.protocol !== "TLSv1.3") ||
    !Number.isFinite(notBeforeMilliseconds) ||
    !Number.isFinite(notAfterMilliseconds) ||
    notBeforeMilliseconds > observedMilliseconds ||
    observedMilliseconds >= notAfterMilliseconds
  ) {
    throw new Error("publication_canary_tls_verification_failed")
  }

  return {
    hostname: input.hostname,
    serverName: input.serverName,
    certificateVerified: true,
    hostnameMatched: true,
    normalCertificateVerification: true,
    protocol: raw.protocol,
    certificateNotBefore: new Date(notBeforeMilliseconds).toISOString(),
    certificateNotAfter: new Date(notAfterMilliseconds).toISOString(),
    observedAt,
  }
}

export type PublicationCanaryFetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

function expectedHttpRequest(input: PublicationCanaryHttpRequest): boolean {
  const expectedPath =
    input.kind === "protected_exact_host_challenge"
      ? ADVOCATE_PUBLICATION_CANARY_PATH
      : "/"
  const expectedMethod =
    input.kind === "protected_exact_host_challenge" ? "POST" : "GET"
  if (
    !isExactProductionAdvocateHostname(input.hostname) ||
    input.url !== `https://${input.hostname}${expectedPath}` ||
    input.method !== expectedMethod ||
    input.redirect !== "error" ||
    input.credentials !== "omit" ||
    input.cache !== "no-store" ||
    !Number.isSafeInteger(input.maxResponseBytes) ||
    input.maxResponseBytes < 1 ||
    input.maxResponseBytes > MAXIMUM_HTTP_RESPONSE_BYTES
  ) {
    return false
  }
  assertNetworkTimeout(input.timeoutMs)

  const entries = Object.entries(input.headers)
  const expectedHeaderNames =
    input.kind === "protected_exact_host_challenge"
      ? ["Accept", "Authorization"]
      : ["Accept"]
  if (
    entries.length !== expectedHeaderNames.length ||
    !expectedHeaderNames.every((name) => Object.hasOwn(input.headers, name))
  ) {
    return false
  }
  return entries.every(
    ([name, value]) =>
      expectedHeaderNames.includes(name) &&
      typeof value === "string" &&
      SAFE_HEADER_VALUE_PATTERN.test(value),
  )
}

async function readBoundedResponseBody(
  chunks: readonly Uint8Array[],
  totalBytes: number,
): Promise<Uint8Array> {
  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

export type PublicationCanaryHttpTransport = (
  input: PublicationCanaryHttpRequest,
  pinnedAddresses: readonly PublicationCanaryPinnedAddress[],
) => Promise<PublicationCanaryHttpResponse>

function pinnedLookup(
  pinnedAddress: PublicationCanaryPinnedAddress,
): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [pinnedAddress])
      return
    }
    callback(null, pinnedAddress.address, pinnedAddress.family)
  }
}

function requestPublicationCanaryPinnedAddress(
  input: PublicationCanaryHttpRequest,
  pinnedAddress: PublicationCanaryPinnedAddress,
  timeoutMs: number,
): Promise<PublicationCanaryHttpResponse> {
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(wallTimeout)
      reject(error)
    }
    const url = new URL(input.url)
    const request = requestHttps({
      protocol: "https:",
      hostname: input.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: input.method,
      headers: input.headers,
      servername: input.hostname,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      lookup: pinnedLookup(pinnedAddress),
      agent: false,
      maxHeaderSize: MAXIMUM_HTTP_RESPONSE_HEADERS_BYTES,
    })
    const wallTimeout = setTimeout(
      () => request.destroy(new Error("publication_canary_http_timeout")),
      timeoutMs,
    )
    wallTimeout.unref?.()
    request.once("error", fail)
    request.once("response", (response) => {
      const contentLengthHeader = response.headers["content-length"]
      const contentLength = Array.isArray(contentLengthHeader)
        ? null
        : (contentLengthHeader ?? null)
      const contentTypeHeader = response.headers["content-type"]
      const contentType = Array.isArray(contentTypeHeader)
        ? ""
        : (contentTypeHeader ?? "")
      if (
        response.statusCode === undefined ||
        contentLengthHeader !== contentLength ||
        (contentLength !== null &&
          (!/^(?:0|[1-9][0-9]*)$/.test(contentLength) ||
            Number(contentLength) > input.maxResponseBytes)) ||
        !SAFE_CONTENT_TYPE_PATTERN.test(contentType)
      ) {
        response.destroy()
        fail(new Error("publication_canary_http_response_invalid"))
        return
      }

      const chunks: Uint8Array[] = []
      let totalBytes = 0
      response.on("data", (chunk: Buffer | string) => {
        if (settled) return
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk
        totalBytes += bytes.byteLength
        if (totalBytes > input.maxResponseBytes) {
          response.destroy()
          fail(new Error("publication_canary_http_response_too_large"))
          return
        }
        chunks.push(bytes)
      })
      response.once("error", fail)
      response.once("end", async () => {
        if (settled) return
        settled = true
        clearTimeout(wallTimeout)
        resolve({
          requestedHostname: input.hostname,
          finalUrl: input.url,
          status: response.statusCode as number,
          redirected: false,
          contentType,
          body: await readBoundedResponseBody(chunks, totalBytes),
        })
      })
    })
    request.end()
  })
}

export const requestPinnedPublicationCanaryHttp: PublicationCanaryHttpTransport =
  async (input, pinnedAddresses) => {
    if (
      pinnedAddresses.length < 1 ||
      !pinnedAddresses.every(({ address, family }) =>
        isAllowedPublicAddress(address, family),
      )
    ) {
      throw new Error("publication_canary_http_pin_invalid")
    }

    const deadline = Date.now() + input.timeoutMs
    let lastError: unknown = new Error("publication_canary_http_unavailable")
    for (const pinnedAddress of pinnedAddresses) {
      const remaining = deadline - Date.now()
      if (remaining < MINIMUM_NETWORK_TIMEOUT_MS) break
      try {
        return await requestPublicationCanaryPinnedAddress(
          input,
          pinnedAddress,
          remaining,
        )
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }

export async function requestPublicationCanaryHttp(
  input: PublicationCanaryHttpRequest,
  options: {
    pinnedAddresses: readonly PublicationCanaryPinnedAddress[]
    transport?: PublicationCanaryHttpTransport
  },
): Promise<PublicationCanaryHttpResponse> {
  if (!expectedHttpRequest(input)) {
    throw new Error("publication_canary_http_input_invalid")
  }
  const response = await (
    options.transport ?? requestPinnedPublicationCanaryHttp
  )(input, options.pinnedAddresses)
  if (
    response.requestedHostname !== input.hostname ||
    response.finalUrl !== input.url ||
    response.redirected !== false ||
    !Number.isSafeInteger(response.status) ||
    response.status < 100 ||
    response.status > 599 ||
    !SAFE_CONTENT_TYPE_PATTERN.test(response.contentType) ||
    !(response.body instanceof Uint8Array) ||
    response.body.byteLength < 1 ||
    response.body.byteLength > input.maxResponseBytes
  ) {
    throw new Error("publication_canary_http_response_invalid")
  }
  return response
}

export async function isPublicationCanaryHostnameProvisioned(
  client: SupabaseClient,
  hostname: string,
): Promise<boolean> {
  if (!isExactProductionAdvocateHostname(hostname)) {
    throw new Error("publication_canary_hostname_invalid")
  }
  const label = hostname.slice(0, -".creatorshare.com".length)
  const domainResult = await client
    .from("advocate_domains")
    .select("id")
    .eq("hostname", hostname)
    .limit(1)
    .maybeSingle()
  if (domainResult.error) {
    throw new Error("publication_canary_hostname_lookup_failed")
  }
  if (domainResult.data !== null) return true

  const reservedResult = await client
    .from("advocate_reserved_subdomains")
    .select("label")
    .eq("label", label)
    .limit(1)
    .maybeSingle()
  if (reservedResult.error) {
    throw new Error("publication_canary_hostname_lookup_failed")
  }
  return reservedResult.data !== null
}

export interface PublicationCanaryRuntimeOptions {
  serviceRoleClient: SupabaseClient
  deploymentIdentity: PublicationCanaryDeploymentIdentity
  environment?: ProvisioningEnvironment
  fetchImplementation?: PublicationCanaryFetchImplementation
  now?: () => number
}

export function createPublicationCanaryRuntimeDependencies(
  options: PublicationCanaryRuntimeOptions,
): PublicationCanaryRunnerDependencies {
  const environment = options.environment ?? process.env
  const now = options.now ?? Date.now
  const fetchImplementation = options.fetchImplementation ?? fetch
  const deploymentIdentity =
    loadPublicationCanaryDeploymentIdentity(environment)
  if (
    options.deploymentIdentity.deploymentId !==
      deploymentIdentity.deploymentId ||
    options.deploymentIdentity.revision !== deploymentIdentity.revision
  ) {
    configurationError()
  }
  let pinnedAddresses: readonly PublicationCanaryPinnedAddress[] | null = null

  return {
    now,
    observeDns(input) {
      return observePublicationCanaryDns(input, {
        expectedCnameTarget:
          loadCloudflareProvisioningConfig(environment).cnameTarget,
        now,
        onPinnedAddresses(addresses) {
          if (pinnedAddresses !== null) {
            throw new Error("publication_canary_dns_repeated")
          }
          pinnedAddresses = addresses
        },
      })
    },
    inspectTls(input) {
      if (pinnedAddresses === null) {
        throw new Error("publication_canary_dns_pin_unavailable")
      }
      return inspectPublicationCanaryTls(input, {
        connect: (connectionInput) =>
          connectPinnedPublicationCanaryTls(
            connectionInput,
            pinnedAddresses as readonly PublicationCanaryPinnedAddress[],
          ),
        now,
      })
    },
    requestHttp(input) {
      if (pinnedAddresses === null) {
        throw new Error("publication_canary_dns_pin_unavailable")
      }
      return requestPublicationCanaryHttp(input, {
        pinnedAddresses,
      })
    },
    createProtectedChallenge(input) {
      if (
        input.deploymentId !== deploymentIdentity.deploymentId ||
        input.revision !== deploymentIdentity.revision
      ) {
        throw new Error("publication_canary_deployment_binding_changed")
      }
      const issuedAt = now()
      const token = createPublicationCanaryToken(input, {
        environment,
        now: () => issuedAt,
      })
      const claims = verifyPublicationCanaryToken(token, {
        environment,
        now: () => issuedAt,
      })
      if (claims === null) {
        throw new Error("publication_canary_challenge_creation_failed")
      }
      return { token, claims }
    },
    verifyProtectedChallengeResponse(rawBody, expectedClaims) {
      return verifyPublicationCanaryResponse(
        rawBody,
        expectedClaims,
        environment,
      )
    },
    isHostnameProvisioned(hostname) {
      return isPublicationCanaryHostnameProvisioned(
        options.serviceRoleClient,
        hostname,
      )
    },
    runStripeUsPaymentCanary(input) {
      return runStripePublicationPaymentCanary(
        loadPublicationPaymentCanaryConfig("stripe_us", environment),
        input,
        { fetchImplementation, now: () => new Date(now()) },
      )
    },
    runStripeUkPaymentCanary(input) {
      return runStripePublicationPaymentCanary(
        loadPublicationPaymentCanaryConfig("stripe_uk", environment),
        input,
        { fetchImplementation, now: () => new Date(now()) },
      )
    },
    runPayPalPaymentCanary(input) {
      return runPayPalPublicationPaymentCanary(
        loadPublicationPaymentCanaryConfig("paypal", environment),
        input,
        { fetchImplementation, now: () => new Date(now()) },
      )
    },
  }
}
