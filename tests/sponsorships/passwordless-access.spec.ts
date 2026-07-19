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

const otpCalls: Array<Record<string, unknown>> = []
const reservationCalls: Array<Record<string, unknown>> = []
let createClientCalls = 0
let createStatelessClientCalls = 0
let getUserCalls = 0
let createClientFailure: Error | null = null
let createStatelessClientFailure: Error | null = null
let getUserFailure: Error | null = null
let getUserError: { message: string } | null = null
let otpFailure: Error | null = null
let otpError: { message: string } | null = null
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
  if (request === "@/lib/sponsorships/management/statelessAuth") {
    return {
      createStatelessSponsorEmailAuthClient() {
        createStatelessClientCalls += 1
        if (createStatelessClientFailure) {
          throw createStatelessClientFailure
        }
        return {
          auth: {
            async signInWithOtp(input: Record<string, unknown>) {
              otpCalls.push(input)
              if (otpFailure) throw otpFailure
              return { data: { user: null }, error: otpError }
            },
          },
        }
      },
    }
  }
  if (request === "@/lib/sponsorships/management/passwordlessRateLimit") {
    return {
      createSponsorPasswordlessDeliverySignals(input: { email: string }) {
        return {
          recipientDigest: input.email,
          sourceDigest: "trusted-source",
        }
      },
      sponsorPasswordlessDeliveryContext() {
        return { requestId: "71000000-0000-4000-8000-000000000001" }
      },
      async reserveSponsorPasswordlessDelivery(input: Record<string, unknown>) {
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

test.beforeEach(() => {
  process.env.NEXT_PUBLIC_BASE_URL = ORIGIN
  otpCalls.length = 0
  reservationCalls.length = 0
  createClientCalls = 0
  createStatelessClientCalls = 0
  getUserCalls = 0
  createClientFailure = null
  createStatelessClientFailure = null
  getUserFailure = null
  getUserError = null
  otpFailure = null
  otpError = null
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
  expect(createStatelessClientCalls).toBe(0)
  expect(reservationCalls).toHaveLength(0)
  expect(otpCalls).toHaveLength(0)
})

test("passwordless access sends one fixed noncreating link", async () => {
  const response = await passwordlessAccessPost(
    requestFor(
      "/api/auth/passwordless",
      JSON.stringify({ email: " Sponsor+Family@Example.com " }),
    ),
  )

  expect(response.status).toBe(202)
  expect(await bodyOf(response)).toEqual({ status: "check-email" })
  expect(response.headers.get("cache-control")).toBe("no-store, max-age=0")
  expect(createClientCalls).toBe(0)
  expect(createStatelessClientCalls).toBe(1)
  expect(reservationCalls).toHaveLength(1)
  expect(otpCalls).toEqual([
    {
      email: "sponsor+family@example.com",
      options: {
        emailRedirectTo: "https://creatorshare.com/auth/confirm?next=%2Fapp",
        shouldCreateUser: false,
      },
    },
  ])
})

test("passwordless access keeps provider and unknown-account failures uniform", async () => {
  otpError = { message: "User not found" }
  const unknownAccount = await passwordlessAccessPost(
    requestFor(
      "/api/auth/passwordless",
      JSON.stringify({ email: "unknown@example.com" }),
    ),
  )

  otpError = null
  otpFailure = new Error("mail provider unavailable")
  const providerFailure = await passwordlessAccessPost(
    requestFor(
      "/api/auth/passwordless",
      JSON.stringify({ email: "known@example.com" }),
    ),
  )

  createStatelessClientFailure = new Error("auth provider unavailable")
  const clientFailure = await passwordlessAccessPost(
    requestFor(
      "/api/auth/passwordless",
      JSON.stringify({ email: "known@example.com" }),
    ),
  )

  for (const response of [unknownAccount, providerFailure, clientFailure]) {
    expect(response.status).toBe(202)
    expect(await bodyOf(response)).toEqual({ status: "check-email" })
  }
})

test("passwordless access hides throttling and reservation failures", async () => {
  deliveryAllowed = false
  const suppressed = await passwordlessAccessPost(
    requestFor(
      "/api/auth/passwordless",
      JSON.stringify({ email: "known@example.com" }),
    ),
  )
  expect(suppressed.status).toBe(202)
  expect(await bodyOf(suppressed)).toEqual({ status: "check-email" })
  expect(reservationCalls).toHaveLength(1)
  expect(createStatelessClientCalls).toBe(0)
  expect(otpCalls).toHaveLength(0)

  deliveryAllowed = true
  reservationFailure = new Error("database unavailable")
  const unavailable = await passwordlessAccessPost(
    requestFor(
      "/api/auth/passwordless",
      JSON.stringify({ email: "known@example.com" }),
    ),
  )
  expect(unavailable.status).toBe(202)
  expect(await bodyOf(unavailable)).toEqual({ status: "check-email" })
  expect(reservationCalls).toHaveLength(2)
  expect(createStatelessClientCalls).toBe(0)
  expect(otpCalls).toHaveLength(0)
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
  expect(createStatelessClientCalls).toBe(0)
  expect(reservationCalls).toHaveLength(0)
  expect(getUserCalls).toBe(0)
  expect(otpCalls).toHaveLength(0)
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
  expect(otpCalls).toHaveLength(0)
})

test("reauthentication derives the recipient from auth and never creates users", async () => {
  authenticatedUser = {
    id: AUTH_USER_ID,
    email: " Sponsor+Family@Example.com ",
    email_confirmed_at: "2026-07-19T08:00:00.000Z",
  }
  const response = await reauthenticationPost(
    requestFor("/api/sponsor-account/reauth/start", "{}"),
  )

  expect(response.status).toBe(202)
  expect(await bodyOf(response)).toEqual({ status: "check-email" })
  expect(getUserCalls).toBe(1)
  expect(otpCalls).toEqual([
    {
      email: "sponsor+family@example.com",
      options: {
        emailRedirectTo: "https://creatorshare.com/auth/confirm?next=%2Fapp",
        shouldCreateUser: false,
      },
    },
  ])
})

test("reauthentication does not disclose magic-link delivery failures", async () => {
  otpError = { message: "provider account detail" }
  const providerError = await reauthenticationPost(
    requestFor("/api/sponsor-account/reauth/start", "{}"),
  )
  otpError = null
  otpFailure = new Error("provider unavailable")
  const providerException = await reauthenticationPost(
    requestFor("/api/sponsor-account/reauth/start", "{}"),
  )

  for (const response of [providerError, providerException]) {
    expect(response.status).toBe(202)
    expect(await bodyOf(response)).toEqual({ status: "check-email" })
  }
})
