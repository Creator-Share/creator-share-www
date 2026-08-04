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
type PasswordlessAccessModule =
  typeof import("../../src/lib/sponsorships/management/passwordlessAccess")
type AccountClaimModule =
  typeof import("../../src/lib/sponsorships/accountClaim")
type PasswordlessRouteModule =
  typeof import("../../src/app/api/auth/passwordless/route")
type ReauthenticationRouteModule =
  typeof import("../../src/app/api/sponsor-account/reauth/start/route")

interface MockAuthUser {
  id: string
  email: string | null
  email_confirmed_at: string | null
}

const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111"
const ORIGIN = "https://creatorshare.com"
const PREVIOUS_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL

const deliveryContext = Object.freeze({
  requestId: "71000000-0000-4000-8000-000000000001",
  traceId: null,
})
const events: string[] = []
const contextCalls: Request[] = []
const signalCalls: Array<Record<string, unknown>> = []
const genericIssuerCalls: Array<Record<string, unknown>> = []
const reauthenticationIssuerCalls: Array<Record<string, unknown>> = []
const reservationCalls: Array<Record<string, unknown>> = []
let createClientCalls = 0
let getUserCalls = 0
let createClientFailure: Error | null = null
let getUserFailure: Error | null = null
let getUserError: { message: string } | null = null
let contextFailure: Error | null = null
let signalFailure: Error | null = null
let issuerFailure: Error | null = null
let issuerResult: unknown = Object.freeze({ status: "issued" })
let deliveryAllowed = true
let reservationFailure: Error | null = null
let authenticatedUser: MockAuthUser | null = {
  id: AUTH_USER_ID,
  email: "sponsor@example.com",
  email_confirmed_at: "2026-07-19T08:00:00.000Z",
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
        createClientCalls += 1
        if (createClientFailure) throw createClientFailure
        return {
          auth: {
            async getUser() {
              getUserCalls += 1
              if (getUserFailure) throw getUserFailure
              return {
                data: { user: authenticatedUser },
                error: getUserError,
              }
            },
          },
        }
      },
    }
  }
  if (request === "@/lib/auth/supabaseEmailProofIssuer") {
    return {
      async issueGenericSignInEmailProof(input: Record<string, unknown>) {
        events.push("issue-generic")
        genericIssuerCalls.push(input)
        if (issuerFailure) throw issuerFailure
        return issuerResult
      },
      async issueReauthenticationEmailProof(input: Record<string, unknown>) {
        events.push("issue-reauthentication")
        reauthenticationIssuerCalls.push(input)
        if (issuerFailure) throw issuerFailure
        return issuerResult
      },
    }
  }
  if (request === "@/lib/sponsorships/management/passwordlessRateLimit") {
    return {
      createSponsorPasswordlessDeliverySignals(
        input: Record<string, unknown> & { email: string },
      ) {
        events.push("signals")
        signalCalls.push(input)
        if (signalFailure) throw signalFailure
        return {
          recipientDigest: input.email,
          sourceDigest: "trusted-source",
        }
      },
      sponsorPasswordlessDeliveryContext(input: Request) {
        events.push("context")
        contextCalls.push(input)
        if (contextFailure) throw contextFailure
        return deliveryContext
      },
      async reserveSponsorPasswordlessDelivery(input: Record<string, unknown>) {
        events.push("reserve")
        reservationCalls.push(input)
        if (reservationFailure) throw reservationFailure
        return deliveryAllowed
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(process.cwd(), "tests/sponsorships/passwordless-access.spec.ts"),
)
const passwordlessAccess = testRequire(
  "../../src/lib/sponsorships/management/passwordlessAccess",
) as PasswordlessAccessModule
const accountClaim = testRequire(
  "../../src/lib/sponsorships/accountClaim",
) as AccountClaimModule
const { POST: passwordlessAccessPost } = testRequire(
  "../../src/app/api/auth/passwordless/route",
) as PasswordlessRouteModule
const { POST: reauthenticationPost } = testRequire(
  "../../src/app/api/sponsor-account/reauth/start/route",
) as ReauthenticationRouteModule
nodeModule._load = originalModuleLoad

const {
  buildSponsorManagementMagicLinkCallback,
  isValidSponsorReauthenticationBody,
  parsePasswordlessAccessRequest,
  SPONSOR_ACCOUNT_MANAGEMENT_PAGE_PATH,
} = passwordlessAccess
const { buildSponsorClaimPageRedirect, getAllowedSponsorClaimCallbackTarget } =
  accountClaim

function requestFor(
  path: string,
  serializedBody: string,
  options: {
    host?: string
    origin?: string | null
    fetchSite?: string | null
    contentType?: string | null
    contentLength?: string | null
  } = {},
): NextRequest {
  const host = options.host ?? "creatorshare.com"
  const origin =
    options.origin === undefined ? `https://${host}` : options.origin
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

  return new NextRequest(`https://${host}${path}`, {
    method: "POST",
    headers,
    body: serializedBody,
  })
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

async function expectCheckEmailResponse(
  response: Response,
  forbiddenText: readonly string[] = [],
): Promise<void> {
  expect(response.status).toBe(202)
  const body = await bodyOf(response)
  expect(body).toEqual({ status: "check-email" })
  const serializedBody = JSON.stringify(body)
  for (const value of forbiddenText) expect(serializedBody).not.toContain(value)
  expect(response.headers.get("cache-control")).toBe("no-store, max-age=0")
  expect(response.headers.get("pragma")).toBe("no-cache")
  expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  expect(response.headers.get("retry-after")).toBeNull()
}

test.beforeEach(() => {
  process.env.NEXT_PUBLIC_BASE_URL = ORIGIN
  events.length = 0
  contextCalls.length = 0
  signalCalls.length = 0
  genericIssuerCalls.length = 0
  reauthenticationIssuerCalls.length = 0
  reservationCalls.length = 0
  createClientCalls = 0
  getUserCalls = 0
  createClientFailure = null
  getUserFailure = null
  getUserError = null
  contextFailure = null
  signalFailure = null
  issuerFailure = null
  issuerResult = Object.freeze({ status: "issued" })
  deliveryAllowed = true
  reservationFailure = null
  authenticatedUser = {
    id: AUTH_USER_ID,
    email: "sponsor@example.com",
    email_confirmed_at: "2026-07-19T08:00:00.000Z",
  }
})

test.afterAll(() => {
  if (PREVIOUS_BASE_URL === undefined) {
    delete process.env.NEXT_PUBLIC_BASE_URL
  } else {
    process.env.NEXT_PUBLIC_BASE_URL = PREVIOUS_BASE_URL
  }
})

test("normalizes one bounded email and rejects boundary expansion", () => {
  expect(
    parsePasswordlessAccessRequest(
      JSON.stringify({ email: " Sponsor+Family@Example.com " }),
    ),
  ).toEqual({ email: "sponsor+family@example.com" })

  for (const body of [
    "not-json",
    "[]",
    JSON.stringify({}),
    JSON.stringify({ email: "not-an-email" }),
    JSON.stringify({ email: "sponsor@example.com", next: "/admin" }),
    JSON.stringify({ email: "sponsor@example.com", password: "secret" }),
    JSON.stringify({ email: `${"a".repeat(65)}@example.com` }),
    "x".repeat(1025),
  ]) {
    expect(parsePasswordlessAccessRequest(body)).toBeNull()
  }
})

test("keeps management callbacks on the fixed primary app path", () => {
  expect(buildSponsorManagementMagicLinkCallback(ORIGIN)).toBe(
    "https://creatorshare.com/auth/confirm?next=%2Fapp",
  )
  expect(SPONSOR_ACCOUNT_MANAGEMENT_PAGE_PATH).toBe("/app")
  expect(getAllowedSponsorClaimCallbackTarget("/app")).toBe("/app")
  expect(getAllowedSponsorClaimCallbackTarget("//attacker.example")).toBe(
    "/sponsor/claim",
  )
  expect(
    buildSponsorClaimPageRedirect(
      ORIGIN,
      "https://attacker.example/collect",
      "ready",
    ).toString(),
  ).toBe("https://creatorshare.com/sponsor/claim?state=ready")
  expect(
    buildSponsorClaimPageRedirect(ORIGIN, "/app", "ready").toString(),
  ).toBe("https://creatorshare.com/app?state=ready")
})

test("accepts only an exact empty reauthentication request", () => {
  expect(isValidSponsorReauthenticationBody("{}")).toBe(true)
  expect(isValidSponsorReauthenticationBody(" { } ")).toBe(true)
  for (const body of [
    "",
    "null",
    "[]",
    "not-json",
    JSON.stringify({ email: "sponsor@example.com" }),
    JSON.stringify({ next: "/admin" }),
    " ".repeat(65),
  ]) {
    expect(isValidSponsorReauthenticationBody(body)).toBe(false)
  }
})

test("passwordless access rejects untrusted or malformed requests before Supabase", async () => {
  const validBody = JSON.stringify({ email: "sponsor@example.com" })
  const responses = await Promise.all([
    passwordlessAccessPost(
      requestFor("/api/auth/passwordless", validBody, {
        origin: "https://attacker.example",
        fetchSite: "cross-site",
      }),
    ),
    passwordlessAccessPost(
      requestFor("/api/auth/passwordless", validBody, {
        host: "hope.creatorshare.com",
      }),
    ),
    passwordlessAccessPost(
      requestFor("/api/auth/passwordless", validBody, {
        host: "www.creatorshare.com",
      }),
    ),
    passwordlessAccessPost(
      requestFor("/api/auth/passwordless", validBody, {
        host: "creator-share-www.vercel.app",
      }),
    ),
    passwordlessAccessPost(
      requestFor("/api/auth/passwordless", validBody, {
        contentType: "text/plain",
      }),
    ),
    passwordlessAccessPost(requestFor("/api/auth/passwordless", "not-json")),
    passwordlessAccessPost(
      requestFor("/api/auth/passwordless", validBody, {
        contentLength: "1025",
      }),
    ),
  ])

  for (const response of responses) {
    expect(response.status).toBe(400)
    expect(await bodyOf(response)).toEqual({ error: "invalid-request" })
  }
  expect(createClientCalls).toBe(0)
  expect(contextCalls).toHaveLength(0)
  expect(reservationCalls).toHaveLength(0)
  expect(genericIssuerCalls).toHaveLength(0)
  expect(reauthenticationIssuerCalls).toHaveLength(0)
})

test("passwordless access reserves and issues with one exact context", async () => {
  const request = requestFor(
    "/api/auth/passwordless",
    JSON.stringify({ email: " Sponsor+Family@Example.com " }),
  )
  const response = await passwordlessAccessPost(request)

  await expectCheckEmailResponse(response)
  expect(createClientCalls).toBe(0)
  expect(events).toEqual(["context", "signals", "reserve", "issue-generic"])
  expect(contextCalls).toEqual([request])
  expect(signalCalls).toHaveLength(1)
  expect(signalCalls[0].email).toBe("sponsor+family@example.com")
  expect(signalCalls[0].headers).toBe(request.headers)
  expect(reservationCalls).toHaveLength(1)
  expect(reservationCalls[0].flow).toBe("generic-sign-in")
  expect(reservationCalls[0].signals).toEqual({
    recipientDigest: "sponsor+family@example.com",
    sourceDigest: "trusted-source",
  })
  expect(reservationCalls[0].context).toBe(deliveryContext)
  expect(genericIssuerCalls).toEqual([
    {
      recipientEmail: "sponsor+family@example.com",
      redirectTo: "https://creatorshare.com/auth/confirm?next=%2Fapp",
      context: deliveryContext,
    },
  ])
  expect(genericIssuerCalls[0].context).toBe(reservationCalls[0].context)
  expect(reauthenticationIssuerCalls).toHaveLength(0)
})

test("passwordless access keeps every issuer outcome uniform", async () => {
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

  for (const [index, disposition] of dispositions.entries()) {
    issuerResult = disposition
    const response = await passwordlessAccessPost(
      requestFor(
        "/api/auth/passwordless",
        JSON.stringify({ email: `sponsor${index}@example.com` }),
      ),
    )
    await expectCheckEmailResponse(response, [
      `sponsor${index}@example.com`,
      disposition.status,
      "retryAfterSeconds",
    ])
  }

  issuerFailure = new Error(
    "provider failed for private-sponsor@example.com with secret detail",
  )
  const exception = await passwordlessAccessPost(
    requestFor(
      "/api/auth/passwordless",
      JSON.stringify({ email: "private-sponsor@example.com" }),
    ),
  )
  await expectCheckEmailResponse(exception, [
    "private-sponsor@example.com",
    "provider failed",
    "secret detail",
  ])
  expect(genericIssuerCalls).toHaveLength(dispositions.length + 1)
})

test("passwordless access hides throttling and reservation failures", async () => {
  deliveryAllowed = false
  const suppressed = await passwordlessAccessPost(
    requestFor(
      "/api/auth/passwordless",
      JSON.stringify({ email: "known@example.com" }),
    ),
  )
  await expectCheckEmailResponse(suppressed, ["known@example.com"])
  expect(events).toEqual(["context", "signals", "reserve"])
  expect(reservationCalls).toHaveLength(1)
  expect(genericIssuerCalls).toHaveLength(0)

  events.length = 0
  deliveryAllowed = true
  reservationFailure = new Error("database unavailable")
  const unavailable = await passwordlessAccessPost(
    requestFor(
      "/api/auth/passwordless",
      JSON.stringify({ email: "known@example.com" }),
    ),
  )
  await expectCheckEmailResponse(unavailable, [
    "known@example.com",
    "database unavailable",
  ])
  expect(events).toEqual(["context", "signals", "reserve"])
  expect(reservationCalls).toHaveLength(2)
  expect(genericIssuerCalls).toHaveLength(0)
})

test("passwordless access stops on private context and signal failures", async () => {
  contextFailure = new Error("private context failure")
  const contextUnavailable = await passwordlessAccessPost(
    requestFor(
      "/api/auth/passwordless",
      JSON.stringify({ email: "known@example.com" }),
    ),
  )
  await expectCheckEmailResponse(contextUnavailable, [
    "known@example.com",
    "private context failure",
  ])
  expect(events).toEqual(["context"])
  expect(reservationCalls).toHaveLength(0)
  expect(genericIssuerCalls).toHaveLength(0)

  events.length = 0
  contextFailure = null
  signalFailure = new Error("private signal failure")
  const signalUnavailable = await passwordlessAccessPost(
    requestFor(
      "/api/auth/passwordless",
      JSON.stringify({ email: "known@example.com" }),
    ),
  )
  await expectCheckEmailResponse(signalUnavailable, [
    "known@example.com",
    "private signal failure",
  ])
  expect(events).toEqual(["context", "signals"])
  expect(reservationCalls).toHaveLength(0)
  expect(genericIssuerCalls).toHaveLength(0)
})

test("reauthentication rejects browser identity and redirect input before auth", async () => {
  const responses = await Promise.all([
    reauthenticationPost(
      requestFor(
        "/api/sponsor-account/reauth/start",
        JSON.stringify({ email: "attacker@example.com" }),
      ),
    ),
    reauthenticationPost(
      requestFor(
        "/api/sponsor-account/reauth/start",
        JSON.stringify({ next: "https://attacker.example" }),
      ),
    ),
    reauthenticationPost(
      requestFor("/api/sponsor-account/reauth/start", "{}", {
        origin: "https://hope.creatorshare.com",
      }),
    ),
  ])

  for (const response of responses) {
    expect(response.status).toBe(400)
    expect(await bodyOf(response)).toEqual({ error: "invalid-request" })
  }
  expect(createClientCalls).toBe(0)
  expect(contextCalls).toHaveLength(0)
  expect(reservationCalls).toHaveLength(0)
  expect(getUserCalls).toBe(0)
  expect(genericIssuerCalls).toHaveLength(0)
  expect(reauthenticationIssuerCalls).toHaveLength(0)
})

test("reauthentication requires one confirmed authenticated email", async () => {
  authenticatedUser = null
  const signedOut = await reauthenticationPost(
    requestFor("/api/sponsor-account/reauth/start", "{}"),
  )
  expect(signedOut.status).toBe(401)
  expect(await bodyOf(signedOut)).toEqual({ error: "unauthorized" })

  authenticatedUser = {
    id: AUTH_USER_ID,
    email: "sponsor@example.com",
    email_confirmed_at: null,
  }
  const unconfirmed = await reauthenticationPost(
    requestFor("/api/sponsor-account/reauth/start", "{}"),
  )
  expect(unconfirmed.status).toBe(401)
  expect(await bodyOf(unconfirmed)).toEqual({ error: "unauthorized" })
  expect(reauthenticationIssuerCalls).toHaveLength(0)
})

test("reauthentication derives its recipient and shares one exact context", async () => {
  authenticatedUser = {
    id: AUTH_USER_ID,
    email: " Sponsor+Family@Example.com ",
    email_confirmed_at: "2026-07-19T08:00:00.000Z",
  }
  const request = requestFor("/api/sponsor-account/reauth/start", "{}")
  const response = await reauthenticationPost(request)

  await expectCheckEmailResponse(response)
  expect(getUserCalls).toBe(1)
  expect(events).toEqual([
    "context",
    "signals",
    "reserve",
    "issue-reauthentication",
  ])
  expect(contextCalls).toEqual([request])
  expect(signalCalls).toHaveLength(1)
  expect(signalCalls[0].email).toBe("sponsor+family@example.com")
  expect(signalCalls[0].headers).toBe(request.headers)
  expect(reservationCalls).toHaveLength(1)
  expect(reservationCalls[0].flow).toBe("reauthentication")
  expect(reservationCalls[0].signals).toEqual({
    recipientDigest: "sponsor+family@example.com",
    sourceDigest: "trusted-source",
  })
  expect(reservationCalls[0].context).toBe(deliveryContext)
  expect(reauthenticationIssuerCalls).toEqual([
    {
      recipientEmail: "sponsor+family@example.com",
      redirectTo: "https://creatorshare.com/auth/confirm?next=%2Fapp",
      context: deliveryContext,
    },
  ])
  expect(reauthenticationIssuerCalls[0].context).toBe(
    reservationCalls[0].context,
  )
  expect(genericIssuerCalls).toHaveLength(0)
})

test("reauthentication hides quota and every issuer outcome", async () => {
  deliveryAllowed = false
  const suppressed = await reauthenticationPost(
    requestFor("/api/sponsor-account/reauth/start", "{}"),
  )
  await expectCheckEmailResponse(suppressed, ["sponsor@example.com"])
  expect(events).toEqual(["context", "signals", "reserve"])
  expect(reauthenticationIssuerCalls).toHaveLength(0)

  events.length = 0
  deliveryAllowed = true
  reservationFailure = new Error("database unavailable")
  const reservationUnavailable = await reauthenticationPost(
    requestFor("/api/sponsor-account/reauth/start", "{}"),
  )
  await expectCheckEmailResponse(reservationUnavailable, [
    "sponsor@example.com",
    "database unavailable",
  ])
  expect(events).toEqual(["context", "signals", "reserve"])
  expect(reauthenticationIssuerCalls).toHaveLength(0)

  events.length = 0
  reservationFailure = null
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
    issuerResult = disposition
    const response = await reauthenticationPost(
      requestFor("/api/sponsor-account/reauth/start", "{}"),
    )
    await expectCheckEmailResponse(response, [
      "sponsor@example.com",
      disposition.status,
      "retryAfterSeconds",
    ])
  }

  issuerFailure = new Error("provider account detail")
  const issuerException = await reauthenticationPost(
    requestFor("/api/sponsor-account/reauth/start", "{}"),
  )
  await expectCheckEmailResponse(issuerException, [
    "sponsor@example.com",
    "provider account detail",
  ])
  expect(reauthenticationIssuerCalls).toHaveLength(dispositions.length + 1)
})

test("reauthentication stops on private context and signal failures", async () => {
  contextFailure = new Error("private context failure")
  const contextUnavailable = await reauthenticationPost(
    requestFor("/api/sponsor-account/reauth/start", "{}"),
  )
  await expectCheckEmailResponse(contextUnavailable, [
    "sponsor@example.com",
    "private context failure",
  ])
  expect(events).toEqual(["context"])
  expect(reservationCalls).toHaveLength(0)
  expect(reauthenticationIssuerCalls).toHaveLength(0)

  events.length = 0
  contextFailure = null
  signalFailure = new Error("private signal failure")
  const signalUnavailable = await reauthenticationPost(
    requestFor("/api/sponsor-account/reauth/start", "{}"),
  )
  await expectCheckEmailResponse(signalUnavailable, [
    "sponsor@example.com",
    "private signal failure",
  ])
  expect(events).toEqual(["context", "signals"])
  expect(reservationCalls).toHaveLength(0)
  expect(reauthenticationIssuerCalls).toHaveLength(0)
})
