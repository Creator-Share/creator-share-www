import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { NextRequest } from "next/server"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown
type StartRouteModule =
  typeof import("../../src/app/api/sponsor-account/start/route")
type CompleteRouteModule =
  typeof import("../../src/app/api/sponsor-account/complete/route")
type AccountClaimModule =
  typeof import("../../src/lib/sponsorships/accountClaim")

interface MockAuthUser {
  id: string
  email: string | null
  email_confirmed_at: string | null
}

const ORIGIN = "https://creatorshare.com"
const START_PATH = "/api/sponsor-account/start"
const COMPLETE_PATH = "/api/sponsor-account/complete"
const CLAIM_TOKEN = "A".repeat(43)
const OTHER_CLAIM_TOKEN = "B".repeat(43)
const CLAIM_EMAIL = "sponsor+family@example.com"
const AUTH_USER_ID = "90000000-0000-4000-8000-000000000001"
const APP_SECRET = Buffer.from(
  "creator-share-route-account-claim-test-secret-000000000000",
  "utf8",
).toString("base64")
const PREVIOUS_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL
const PREVIOUS_CRYPTO_SECRET = process.env.SPONSORSHIP_CRYPTO_SECRET_V1
const PREVIOUS_VERCEL = process.env.VERCEL

const deliveryContext = Object.freeze({
  requestId: "71000000-0000-4000-8000-000000000001",
  traceId: "iad1::claim-route-test",
})
const deliverySignals = Object.freeze({
  recipientDigest: "\\x" + "1".repeat(64),
  recipientNormalizationVersion: 1,
  recipientHmacKeyVersion: 1,
  sourceDigest: "\\x" + "2".repeat(64),
  sourceHmacKeyVersion: 1,
})

const events: string[] = []
const contextCalls: Request[] = []
const serviceClientOptions: Array<Record<string, unknown>> = []
const serviceRpcCalls: Array<{
  name: string
  input: Record<string, unknown>
}> = []
const authRpcCalls: Array<{
  name: string
  input: Record<string, unknown>
}> = []
const signalCalls: Array<Record<string, unknown>> = []
const reservationCalls: Array<Record<string, unknown>> = []
const initialIssuerCalls: Array<Record<string, unknown>> = []
const accountIssuerCalls: Array<Record<string, unknown>> = []

let createAuthClientCalls = 0
let createAuthClientFailure: Error | null = null
let createServiceClientFailure: Error | null = null
let getUserFailure: Error | null = null
let getUserError: { message: string } | null = null
let contextFailure: Error | null = null
let signalFailure: Error | null = null
let reservationFailure: Error | null = null
let reservationAllowed = true
let initialIssuerFailure: Error | null = null
let accountIssuerFailure: Error | null = null
let issuerResult: unknown = Object.freeze({ status: "issued" })
let resolverData: unknown = [{ claim_start_mode: "initial-claim" }]
let resolverError: unknown = null
let verificationError: unknown = null
let consumeData: unknown = [{ linked_subscription_count: 3 }]
let consumeError: unknown = null
let authenticatedUser: MockAuthUser | null = null

const serviceClient = {
  async rpc(name: string, input: Record<string, unknown>) {
    events.push(`service-rpc:${name}`)
    serviceRpcCalls.push({ name, input })
    if (name === "resolve_sponsor_account_claim_start") {
      return { data: resolverData, error: resolverError }
    }
    if (name === "issue_sponsor_account_email_verification") {
      return { data: null, error: verificationError }
    }
    throw new Error("unexpected service RPC")
  },
}

const authClient = {
  auth: {
    async getUser() {
      events.push("get-user")
      if (getUserFailure) throw getUserFailure
      return { data: { user: authenticatedUser }, error: getUserError }
    },
  },
  async rpc(name: string, input: Record<string, unknown>) {
    events.push(`auth-rpc:${name}`)
    authRpcCalls.push({ name, input })
    if (name !== "consume_sponsorship_account_claim") {
      throw new Error("unexpected auth RPC")
    }
    return { data: consumeData, error: consumeError }
  },
}

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  if (request === "@/utils/supabase/server") {
    return {
      async createClient() {
        events.push("auth-client")
        createAuthClientCalls += 1
        if (createAuthClientFailure) throw createAuthClientFailure
        return authClient
      },
      createServiceRoleClient(options: Record<string, unknown> = {}) {
        events.push("service-client")
        serviceClientOptions.push(options)
        if (createServiceClientFailure) throw createServiceClientFailure
        return serviceClient
      },
    }
  }
  if (request === "@/lib/auth/supabaseEmailProofIssuer") {
    return {
      async issueInitialClaimEmailProof(input: Record<string, unknown>) {
        events.push("issue-initial")
        initialIssuerCalls.push(input)
        if (initialIssuerFailure) throw initialIssuerFailure
        return issuerResult
      },
      async issueAccountClaimEmailProof(input: Record<string, unknown>) {
        events.push("issue-account")
        accountIssuerCalls.push(input)
        if (accountIssuerFailure) throw accountIssuerFailure
        return issuerResult
      },
    }
  }
  if (request === "@/lib/sponsorships/management/passwordlessRateLimit") {
    return {
      sponsorPasswordlessDeliveryContext(input: Request) {
        events.push("context")
        contextCalls.push(input)
        if (contextFailure) throw contextFailure
        return deliveryContext
      },
      createSponsorPasswordlessDeliverySignals(input: Record<string, unknown>) {
        events.push("signals")
        signalCalls.push(input)
        if (signalFailure) throw signalFailure
        return deliverySignals
      },
      async reserveSponsorPasswordlessDelivery(input: Record<string, unknown>) {
        events.push("reserve")
        reservationCalls.push(input)
        if (reservationFailure) throw reservationFailure
        return reservationAllowed
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(process.cwd(), "tests/sponsorships/sponsor-claim-routes.spec.ts"),
)
const accountClaim = testRequire(
  "../../src/lib/sponsorships/accountClaim",
) as AccountClaimModule
const startRoutePath = testRequire.resolve(
  "../../src/app/api/sponsor-account/start/route",
)
const completeRoutePath = testRequire.resolve(
  "../../src/app/api/sponsor-account/complete/route",
)
delete testRequire.cache[startRoutePath]
delete testRequire.cache[completeRoutePath]
const { POST: startClaim, runtime: startRuntime } = testRequire(
  startRoutePath,
) as StartRouteModule
const { POST: completeClaim, runtime: completeRuntime } = testRequire(
  completeRoutePath,
) as CompleteRouteModule
delete testRequire.cache[startRoutePath]
delete testRequire.cache[completeRoutePath]
nodeModule._load = originalModuleLoad

const {
  LEGACY_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME,
  LOCAL_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME,
  SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME,
} = accountClaim

function startRequest(
  body: BodyInit,
  options: {
    host?: string
    transportOrigin?: string
    origin?: string | null
    fetchSite?: string | null
    contentType?: string | null
    contentLength?: string | null
  } = {},
): NextRequest {
  const host = options.host ?? "creatorshare.com"
  const transportOrigin = options.transportOrigin ?? `https://${host}`
  const origin = options.origin === undefined ? transportOrigin : options.origin
  const headers = new Headers({ host })
  if (origin !== null) headers.set("origin", origin)
  if (options.fetchSite !== null) {
    headers.set("sec-fetch-site", options.fetchSite ?? "same-origin")
  }
  if (options.contentType !== null) {
    headers.set(
      "content-type",
      options.contentType ?? "application/json; charset=utf-8",
    )
  }
  if (options.contentLength !== undefined) {
    if (options.contentLength === null) headers.delete("content-length")
    else headers.set("content-length", options.contentLength)
  }
  const init = {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as unknown as ConstructorParameters<typeof NextRequest>[1]
  return new NextRequest(`${transportOrigin}${START_PATH}`, init)
}

function completeRequest(
  cookie: string | null,
  options: {
    host?: string
    transportOrigin?: string
    origin?: string | null
    fetchSite?: string | null
    userAgent?: string | null
    forwardedFor?: string | null
  } = {},
): NextRequest {
  const host = options.host ?? "creatorshare.com"
  const transportOrigin = options.transportOrigin ?? `https://${host}`
  const origin = options.origin === undefined ? transportOrigin : options.origin
  const headers = new Headers({ host })
  if (origin !== null) headers.set("origin", origin)
  if (options.fetchSite !== null) {
    headers.set("sec-fetch-site", options.fetchSite ?? "same-origin")
  }
  if (cookie !== null) headers.set("cookie", cookie)
  if (options.userAgent !== null) {
    headers.set("user-agent", options.userAgent ?? "Claim Route Test Browser")
  }
  if (options.forwardedFor !== null) {
    headers.set("x-vercel-forwarded-for", options.forwardedFor ?? "203.0.113.8")
  }
  return new NextRequest(`${transportOrigin}${COMPLETE_PATH}`, {
    method: "POST",
    headers,
  })
}

function completeRequestWithRawUserAgent(userAgent: string): NextRequest {
  const request = completeRequest(canonicalCookie())
  return {
    headers: {
      get(name: string) {
        return name.toLowerCase() === "user-agent"
          ? userAgent
          : request.headers.get(name)
      },
    },
    nextUrl: request.nextUrl,
  } as unknown as NextRequest
}

function validStartBody(email = CLAIM_EMAIL): string {
  return JSON.stringify({ token: CLAIM_TOKEN, email })
}

function canonicalCookie(token = CLAIM_TOKEN): string {
  return `${SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME}=${token}`
}

function legacyCookie(token = OTHER_CLAIM_TOKEN): string {
  return `${LEGACY_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME}=${token}`
}

function localCookie(token = OTHER_CLAIM_TOKEN): string {
  return `${LOCAL_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME}=${token}`
}

async function responseBody(
  response: Response,
): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

function setCookieHeaders(response: Response): string[] {
  return response.headers.getSetCookie()
}

function expectPrivacyHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store, max-age=0")
  expect(response.headers.get("pragma")).toBe("no-cache")
  expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  expect(response.headers.get("retry-after")).toBeNull()
}

function expectLegacyTombstones(response: Response, finalPath: string): void {
  const headers = setCookieHeaders(response)
  for (const path of [
    "/",
    "/api",
    "/api/",
    "/api/sponsor-account",
    "/api/sponsor-account/",
    finalPath,
  ]) {
    expect(
      headers.some(
        (header) =>
          header.startsWith(
            `${LEGACY_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME}=; Path=${path};`,
          ) && !header.includes("Domain="),
      ),
    ).toBe(true)
    expect(
      headers.some((header) =>
        header.startsWith(
          `${LEGACY_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME}=; Path=${path}; Domain=.creatorshare.com;`,
        ),
      ),
    ).toBe(true)
  }
}

function resetObservations(): void {
  events.length = 0
  contextCalls.length = 0
  serviceClientOptions.length = 0
  serviceRpcCalls.length = 0
  authRpcCalls.length = 0
  signalCalls.length = 0
  reservationCalls.length = 0
  initialIssuerCalls.length = 0
  accountIssuerCalls.length = 0
  createAuthClientCalls = 0
}

test.beforeEach(() => {
  process.env.NEXT_PUBLIC_BASE_URL = ORIGIN
  process.env.SPONSORSHIP_CRYPTO_SECRET_V1 = APP_SECRET
  delete process.env.VERCEL
  resetObservations()
  createAuthClientFailure = null
  createServiceClientFailure = null
  getUserFailure = null
  getUserError = null
  contextFailure = null
  signalFailure = null
  reservationFailure = null
  reservationAllowed = true
  initialIssuerFailure = null
  accountIssuerFailure = null
  issuerResult = Object.freeze({ status: "issued" })
  resolverData = [{ claim_start_mode: "initial-claim" }]
  resolverError = null
  verificationError = null
  consumeData = [{ linked_subscription_count: 3 }]
  consumeError = null
  authenticatedUser = null
})

test.afterAll(() => {
  if (PREVIOUS_BASE_URL === undefined) delete process.env.NEXT_PUBLIC_BASE_URL
  else process.env.NEXT_PUBLIC_BASE_URL = PREVIOUS_BASE_URL
  if (PREVIOUS_CRYPTO_SECRET === undefined) {
    delete process.env.SPONSORSHIP_CRYPTO_SECRET_V1
  } else {
    process.env.SPONSORSHIP_CRYPTO_SECRET_V1 = PREVIOUS_CRYPTO_SECRET
  }
  if (PREVIOUS_VERCEL === undefined) delete process.env.VERCEL
  else process.env.VERCEL = PREVIOUS_VERCEL
})

test("pins both claim endpoints to the Node runtime", () => {
  expect(startRuntime).toBe("nodejs")
  expect(completeRuntime).toBe("nodejs")
})

test("resolves an initial claim before auth and reuses one service client", async () => {
  const request = startRequest(validStartBody())
  const response = await startClaim(request)
  const body = await responseBody(response)

  expect(response.status).toBe(202)
  expect(body).toEqual({ status: "check-email" })
  expectPrivacyHeaders(response)
  expect(events).toEqual([
    "context",
    "service-client",
    "service-rpc:resolve_sponsor_account_claim_start",
    "auth-client",
    "get-user",
    "signals",
    "reserve",
    "issue-initial",
  ])
  expect(serviceClientOptions).toEqual([{ requestTimeoutMilliseconds: 8_000 }])
  expect(contextCalls).toEqual([request])
  expect(serviceRpcCalls[0].name).toBe("resolve_sponsor_account_claim_start")
  expect(Object.keys(serviceRpcCalls[0].input).sort()).toEqual([
    "context_request_id",
    "context_trace_id",
    "target_claim_token_digest",
    "target_email_hmac",
    "target_email_hmac_key_version",
    "target_email_normalization_version",
  ])
  expect(serviceRpcCalls[0].input).toMatchObject({
    context_request_id: deliveryContext.requestId,
    context_trace_id: deliveryContext.traceId,
    target_claim_token_digest: expect.stringMatching(/^\\x[0-9a-f]{64}$/),
    target_email_hmac: expect.stringMatching(/^\\x[0-9a-f]{64}$/),
    target_email_hmac_key_version: 1,
    target_email_normalization_version: 1,
  })
  const serializedResolverInput = JSON.stringify(serviceRpcCalls[0].input)
  expect(serializedResolverInput).not.toContain(CLAIM_TOKEN)
  expect(serializedResolverInput).not.toContain(CLAIM_EMAIL)
  expect(reservationCalls).toHaveLength(1)
  expect(reservationCalls[0]).toMatchObject({
    flow: "initial-claim",
    signals: deliverySignals,
  })
  expect(reservationCalls[0].context).toBe(deliveryContext)
  expect(reservationCalls[0].serviceClient).toBe(serviceClient)
  expect(initialIssuerCalls).toEqual([
    {
      recipientEmail: CLAIM_EMAIL,
      redirectTo:
        "https://creatorshare.com/auth/confirm?next=%2Fsponsor%2Fclaim",
      context: deliveryContext,
    },
  ])
  expect(initialIssuerCalls[0].context).toBe(reservationCalls[0].context)
  expect(accountIssuerCalls).toEqual([])

  const serializedBody = JSON.stringify(body)
  expect(serializedBody).not.toContain(CLAIM_TOKEN)
  expect(serializedBody).not.toContain(CLAIM_EMAIL)
  const cookies = setCookieHeaders(response)
  expect(cookies[0]).toBe(
    `${SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME}=${CLAIM_TOKEN}; Path=/; Max-Age=1800; HttpOnly; Secure; SameSite=Lax; Priority=High`,
  )
  expect(cookies[0]).not.toContain("Domain=")
  expectLegacyTombstones(response, START_PATH)
})

test("selects the account claim issuer without allowing account creation", async () => {
  resolverData = [{ claim_start_mode: "account-reauth" }]

  const response = await startClaim(startRequest(validStartBody()))

  expect(response.status).toBe(202)
  expect(await responseBody(response)).toEqual({ status: "check-email" })
  expect(reservationCalls[0].flow).toBe("account-claim")
  expect(initialIssuerCalls).toEqual([])
  expect(accountIssuerCalls).toEqual([
    {
      recipientEmail: CLAIM_EMAIL,
      redirectTo:
        "https://creatorshare.com/auth/confirm?next=%2Fsponsor%2Fclaim",
      context: deliveryContext,
    },
  ])
})

test("treats every nonmatching auth outcome as signed out", async () => {
  const scenarios: Array<{
    name: string
    configure(): void
  }> = [
    {
      name: "signed out",
      configure() {
        authenticatedUser = null
      },
    },
    {
      name: "unconfirmed",
      configure() {
        authenticatedUser = {
          id: AUTH_USER_ID,
          email: CLAIM_EMAIL,
          email_confirmed_at: null,
        }
      },
    },
    {
      name: "mismatched",
      configure() {
        authenticatedUser = {
          id: AUTH_USER_ID,
          email: "other@example.com",
          email_confirmed_at: "2026-07-20T08:00:00.000Z",
        }
      },
    },
    {
      name: "getUser error",
      configure() {
        getUserError = { message: "auth lookup failed" }
      },
    },
    {
      name: "getUser exception",
      configure() {
        getUserFailure = new Error("auth lookup unavailable")
      },
    },
    {
      name: "client construction exception",
      configure() {
        createAuthClientFailure = new Error("auth cookies unavailable")
      },
    },
  ]

  for (const scenario of scenarios) {
    await test.step(scenario.name, async () => {
      resetObservations()
      authenticatedUser = null
      getUserError = null
      getUserFailure = null
      createAuthClientFailure = null
      scenario.configure()

      const response = await startClaim(startRequest(validStartBody()))

      expect(response.status).toBe(202)
      expect(await responseBody(response)).toEqual({ status: "check-email" })
      expect(events).toContain("issue-initial")
      expect(initialIssuerCalls).toHaveLength(1)
      expect(accountIssuerCalls).toEqual([])
    })
  }
})

test("returns ready for a matching confirmed account without quota work", async () => {
  authenticatedUser = {
    id: AUTH_USER_ID,
    email: CLAIM_EMAIL,
    email_confirmed_at: "2026-07-20T08:00:00.000Z",
  }

  const response = await startClaim(startRequest(validStartBody()))

  expect(response.status).toBe(200)
  expect(await responseBody(response)).toEqual({ status: "ready" })
  expect(signalCalls).toEqual([])
  expect(reservationCalls).toEqual([])
  expect(initialIssuerCalls).toEqual([])
  expect(accountIssuerCalls).toEqual([])
  expect(setCookieHeaders(response)[0]).toContain(
    `${SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME}=${CLAIM_TOKEN}`,
  )
})

test("does no auth or delivery work for every malformed resolver shape", async () => {
  const malformed = [
    { claim_start_mode: "initial-claim" },
    [],
    [
      { claim_start_mode: "initial-claim" },
      { claim_start_mode: "account-reauth" },
    ],
    [{ claim_start_mode: "initial-claim", extra: true }],
    [{ claim_start_mode: "unknown" }],
  ]

  for (const value of malformed) {
    resetObservations()
    resolverData = value
    const response = await startClaim(startRequest(validStartBody()))
    expect(response.status).toBe(202)
    expect(await responseBody(response)).toEqual({ status: "check-email" })
    expect(createAuthClientCalls).toBe(0)
    expect(reservationCalls).toEqual([])
    expect(initialIssuerCalls).toEqual([])
    expect(accountIssuerCalls).toEqual([])
  }
})

test("hides quota, service, and issuer failures behind one response", async () => {
  const scenarios: Array<() => void> = [
    () => {
      resolverError = new Error("private resolver detail")
    },
    () => {
      createServiceClientFailure = new Error("private service detail")
    },
    () => {
      contextFailure = new Error("private context detail")
    },
    () => {
      signalFailure = new Error("private signal detail")
    },
    () => {
      reservationAllowed = false
    },
    () => {
      reservationFailure = new Error("private quota detail")
    },
    () => {
      initialIssuerFailure = new Error("private provider detail")
    },
  ]

  for (const configure of scenarios) {
    resetObservations()
    resolverError = null
    createServiceClientFailure = null
    contextFailure = null
    signalFailure = null
    reservationAllowed = true
    reservationFailure = null
    initialIssuerFailure = null
    configure()

    const response = await startClaim(startRequest(validStartBody()))
    expect(response.status).toBe(202)
    const body = await responseBody(response)
    expect(body).toEqual({ status: "check-email" })
    expect(JSON.stringify(body)).not.toContain("private")
    expectPrivacyHeaders(response)
    expect(setCookieHeaders(response)[0]).toContain(CLAIM_TOKEN)
  }
})

test("ignores every shared issuer disposition without leaking retry details", async () => {
  const dispositions = [
    Object.freeze({ status: "issued" }),
    Object.freeze({ status: "coalesced", retryAfterSeconds: 30 }),
    Object.freeze({ status: "deferred", retryAfterSeconds: 120 }),
    Object.freeze({ status: "ambiguous", retryAfterSeconds: 3900 }),
    Object.freeze({ status: "unavailable", stage: "configuration" }),
    Object.freeze({ status: "unavailable", stage: "acquire" }),
    Object.freeze({
      status: "unavailable",
      stage: "begin",
      retryAfterSeconds: 3900,
    }),
  ]

  for (const disposition of dispositions) {
    resetObservations()
    issuerResult = disposition
    const response = await startClaim(startRequest(validStartBody()))
    expect(response.status).toBe(202)
    const body = await responseBody(response)
    expect(body).toEqual({ status: "check-email" })
    expect(JSON.stringify(body)).not.toContain(disposition.status)
    expect(response.headers.get("retry-after")).toBeNull()
  }
})

test("rejects untrusted, expanded, and chunked oversized starts before clients", async () => {
  const authorityFields = [
    { shouldCreateUser: false },
    { mode: "account-reauth" },
    { flow: "account-claim" },
    { redirectTo: "https://attacker.example/collect" },
    { role: "admin" },
  ]
  const invalidRequests: NextRequest[] = [
    startRequest(validStartBody(), {
      origin: "https://attacker.example",
      fetchSite: "cross-site",
    }),
    startRequest(validStartBody(), { origin: null }),
    startRequest(validStartBody(), { fetchSite: "cross-site" }),
    startRequest(validStartBody(), { host: "hope.creatorshare.com" }),
    startRequest(validStartBody(), { contentType: "text/plain" }),
    startRequest(validStartBody(), { contentType: null }),
    startRequest("not-json"),
    startRequest(JSON.stringify({ token: "short", email: CLAIM_EMAIL })),
    startRequest(JSON.stringify({ token: CLAIM_TOKEN, email: "not-email" })),
    ...authorityFields.map((field) =>
      startRequest(
        JSON.stringify({ token: CLAIM_TOKEN, email: CLAIM_EMAIL, ...field }),
      ),
    ),
    startRequest(validStartBody(), { contentLength: "4097" }),
    startRequest(validStartBody(), { contentLength: "unknown" }),
  ]
  const oversizedStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(3000)))
      controller.enqueue(new TextEncoder().encode("x".repeat(1097)))
      controller.close()
    },
  })
  invalidRequests.push(startRequest(oversizedStream, { contentLength: null }))

  for (const request of invalidRequests) {
    resetObservations()
    const response = await startClaim(request)
    expect(response.status).toBe(202)
    expect(await responseBody(response)).toEqual({ status: "check-email" })
    expect(events).toEqual([])
    expect(setCookieHeaders(response)).toEqual([])
  }
})

test("completes with the canonical cookie and exact clear topology", async () => {
  authenticatedUser = {
    id: AUTH_USER_ID,
    email: CLAIM_EMAIL,
    email_confirmed_at: "2026-07-20T08:00:00.000Z",
  }
  process.env.VERCEL = "1"
  const request = completeRequest(canonicalCookie(), {
    userAgent: "  Claim Browser  ",
    forwardedFor: "203.0.113.8",
  })

  const response = await completeClaim(request)

  expect(response.status).toBe(200)
  expect(await responseBody(response)).toEqual({ linkedSubscriptionCount: 3 })
  expectPrivacyHeaders(response)
  expect(serviceClientOptions).toEqual([{ requestTimeoutMilliseconds: 8_000 }])
  expect(contextCalls).toEqual([request])
  expect(serviceRpcCalls[0]).toMatchObject({
    name: "issue_sponsor_account_email_verification",
    input: {
      context_request_id: deliveryContext.requestId,
      context_trace_id: deliveryContext.traceId,
    },
  })
  expect(authRpcCalls[0].input).toMatchObject({
    context_request_id: deliveryContext.requestId,
    context_trace_id: deliveryContext.traceId,
    context_client_ip: "203.0.113.8",
    context_user_agent: "Claim Browser",
  })
  const cookies = setCookieHeaders(response)
  expect(cookies[0]).toBe(
    `${SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax; Priority=High`,
  )
  expect(cookies[0]).not.toContain("Domain=")
  expectLegacyTombstones(response, COMPLETE_PATH)
})

test("uses only the canonical capability when legacy cookies are also present", async () => {
  authenticatedUser = {
    id: AUTH_USER_ID,
    email: CLAIM_EMAIL,
    email_confirmed_at: "2026-07-20T08:00:00.000Z",
  }
  let canonicalDigest: unknown
  for (const cookie of [
    `${canonicalCookie()}; ${legacyCookie()}; ${localCookie()}`,
    `${localCookie()}; ${legacyCookie()}; ${canonicalCookie()}`,
  ]) {
    resetObservations()
    const response = await completeClaim(completeRequest(cookie))
    expect(response.status).toBe(200)
    const digest = authRpcCalls[0].input.target_claim_token_digest
    canonicalDigest ??= digest
    expect(digest).toBe(canonicalDigest)
    expectLegacyTombstones(response, COMPLETE_PATH)
  }
})

test("rejects noncanonical and duplicate capabilities before any client", async () => {
  const rejectedCookies = [
    legacyCookie(),
    localCookie(),
    `${canonicalCookie()}; ${canonicalCookie(OTHER_CLAIM_TOKEN)}`,
    `${canonicalCookie(OTHER_CLAIM_TOKEN)}; ${canonicalCookie()}`,
    `${SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME}=malformed`,
  ]

  for (const cookie of rejectedCookies) {
    resetObservations()
    const response = await completeClaim(completeRequest(cookie))
    expect(response.status).toBe(410)
    expect(await responseBody(response)).toEqual({
      error: "invalid-or-expired",
    })
    expect(events).toEqual([])
    expect(createAuthClientCalls).toBe(0)
    expect(serviceClientOptions).toEqual([])
    expect(setCookieHeaders(response)[0]).toContain(
      `${SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME}=;`,
    )
    expectLegacyTombstones(response, COMPLETE_PATH)
  }
})

test("accepts exactly one local fallback cookie only on HTTP loopback", async () => {
  process.env.NEXT_PUBLIC_BASE_URL = "http://localhost:3000"
  authenticatedUser = {
    id: AUTH_USER_ID,
    email: CLAIM_EMAIL,
    email_confirmed_at: "2026-07-20T08:00:00.000Z",
  }

  const response = await completeClaim(
    completeRequest(
      `${LOCAL_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME}=${CLAIM_TOKEN}`,
      {
        host: "localhost:3000",
        transportOrigin: "http://localhost:3000",
        origin: "http://localhost:3000",
      },
    ),
  )

  expect(response.status).toBe(200)
  const cookies = setCookieHeaders(response)
  expect(cookies[0]).toContain(
    `${LOCAL_SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME}=; Path=/; Max-Age=0;`,
  )
  expect(cookies.every((cookie) => !cookie.includes("; Secure;"))).toBe(true)
  expect(cookies.every((cookie) => !cookie.includes("Domain="))).toBe(true)
})

test("never mutates cookies for an untrusted Host or transport origin", async () => {
  const requests = [
    completeRequest(canonicalCookie(), { host: "hope.creatorshare.com" }),
    completeRequest(canonicalCookie(), {
      transportOrigin: "https://www.creatorshare.com",
      origin: ORIGIN,
    }),
    completeRequest(canonicalCookie(), {
      origin: "https://attacker.example",
      fetchSite: "cross-site",
    }),
  ]

  for (const request of requests) {
    resetObservations()
    const response = await completeClaim(request)
    expect(response.status).toBe(403)
    expect(await responseBody(response)).toEqual({ error: "unavailable" })
    expect(events).toEqual([])
    expect(setCookieHeaders(response)).toEqual([])
  }
})

test("keeps the canonical cookie for retryable completion failures", async () => {
  const scenarios: Array<() => void> = [
    () => {
      authenticatedUser = null
    },
    () => {
      authenticatedUser = {
        id: AUTH_USER_ID,
        email: CLAIM_EMAIL,
        email_confirmed_at: "2026-07-20T08:00:00.000Z",
      }
      verificationError = new Error("private database detail")
    },
    () => {
      createAuthClientFailure = new Error("private auth detail")
    },
    () => {
      createServiceClientFailure = new Error("private service detail")
    },
    () => {
      contextFailure = new Error("private context detail")
    },
  ]

  for (const configure of scenarios) {
    resetObservations()
    authenticatedUser = null
    verificationError = null
    createAuthClientFailure = null
    createServiceClientFailure = null
    contextFailure = null
    configure()
    const response = await completeClaim(completeRequest(canonicalCookie()))
    expect([401, 503]).toContain(response.status)
    const body = await responseBody(response)
    expect(JSON.stringify(body)).not.toContain("private")
    expectPrivacyHeaders(response)
    const cookies = setCookieHeaders(response)
    expect(
      cookies.some((cookie) =>
        cookie.startsWith(`${SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME}=;`),
      ),
    ).toBe(false)
    expectLegacyTombstones(response, COMPLETE_PATH)
  }
})

test("clears all claim cookies after terminal completion failures", async () => {
  authenticatedUser = {
    id: AUTH_USER_ID,
    email: CLAIM_EMAIL,
    email_confirmed_at: "2026-07-20T08:00:00.000Z",
  }
  const terminalErrors = [
    { code: "22023", message: "token is invalid" },
    { code: "23514", message: "email does not match" },
    { code: "23505", message: "already owns another sponsor identity" },
  ]

  for (const error of terminalErrors) {
    resetObservations()
    consumeError = error
    const response = await completeClaim(completeRequest(canonicalCookie()))
    expect([409, 410]).toContain(response.status)
    expect(setCookieHeaders(response)[0]).toContain(
      `${SPONSOR_ACCOUNT_CLAIM_COOKIE_NAME}=;`,
    )
    expectLegacyTombstones(response, COMPLETE_PATH)
  }
})

test("delegates trace context and trusts IP only through the Vercel ingress", async () => {
  authenticatedUser = {
    id: AUTH_USER_ID,
    email: CLAIM_EMAIL,
    email_confirmed_at: "2026-07-20T08:00:00.000Z",
  }
  const request = completeRequest(canonicalCookie(), {
    userAgent: "x".repeat(1100),
    forwardedFor: "203.0.113.9",
  })
  request.headers.set("cf-connecting-ip", "198.51.100.4")
  request.headers.set("x-forwarded-for", "198.51.100.5")
  request.headers.set("x-real-ip", "198.51.100.6")
  request.headers.set("traceparent", "spoofed-trace")

  await completeClaim(request)

  expect(authRpcCalls[0].input).toMatchObject({
    context_client_ip: null,
    context_user_agent: "x".repeat(1024),
  })
  expect(authRpcCalls[0].input.context_trace_id).toBe(deliveryContext.traceId)

  resetObservations()
  process.env.VERCEL = "1"
  const invalidIpRequest = completeRequest(canonicalCookie(), {
    forwardedFor: "203.0.113.9, 198.51.100.1",
    userAgent: "   ",
  })
  await completeClaim(invalidIpRequest)
  expect(authRpcCalls[0].input).toMatchObject({
    context_client_ip: null,
    context_user_agent: null,
  })

  resetObservations()
  const controlBearingUserAgent =
    completeRequestWithRawUserAgent("Claim\u0000Browser")
  await completeClaim(controlBearingUserAgent)
  expect(authRpcCalls[0].input.context_user_agent).toBeNull()
})
