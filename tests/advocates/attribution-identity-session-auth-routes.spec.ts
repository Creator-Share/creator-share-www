import { readFileSync } from "node:fs"
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
type LoginRouteModule = typeof import("../../src/app/api/auth/login/route")
type VerifyOtpRouteModule =
  typeof import("../../src/app/api/auth/verify-otp/route")
type RegistrationRouteModule =
  typeof import("../../src/app/api/auth/registration/route")
type AttributionIdentityCookieModule =
  typeof import("../../src/lib/advocates/attributionIdentityCookie")

interface AuthUser {
  id: string
  identities?: Array<Record<string, unknown>>
}

interface AuthSession {
  access_token: string
  refresh_token: string
  token_type: "bearer"
  expires_in: number
  expires_at?: number
  user: AuthUser
}

const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111"
const AUTH_SESSION_ID = "33333333-3333-4333-8333-333333333333"
const SUPABASE_URL = "https://project.supabase.co"
const RECOVERY_AUTH_COOKIE = "__Host-cs-password-recovery-v1"
const CURRENT_SECRET = Buffer.alloc(32, 13).toString("base64")
const CANONICAL_ORIGIN = "https://creatorshare.com"
const REGISTRATION_DELIVERY_CONTEXT = Object.freeze({
  requestId: "71000000-0000-4000-8000-000000000002",
  traceId: null,
})
const PREVIOUS_ENVIRONMENT = {
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1:
    process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1,
  NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_SERVICE_ROLE_KEY: process.env.NEXT_SERVICE_ROLE_KEY,
}

function recoveryAccessToken(): string {
  const encode = (value: Record<string, string>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    sub: AUTH_USER_ID,
    session_id: AUTH_SESSION_ID,
  })}.provider-signature`
}

let passwordLoginData: { user: AuthUser | null } = {
  user: { id: AUTH_USER_ID },
}
let passwordLoginError: { message: string } | null = null
let verificationData: {
  user: AuthUser | null
  session: AuthSession | null
} = {
  user: { id: AUTH_USER_ID },
  session: {
    access_token: recoveryAccessToken(),
    refresh_token: "opaque-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    user: { id: AUTH_USER_ID },
  },
}
let verificationError: { message: string } | null = null
const registrationEvents: string[] = []
const registrationContextCalls: Request[] = []
const registrationSignalCalls: Array<Record<string, unknown>> = []
const registrationIssuerCalls: Array<Record<string, unknown>> = []
const registrationReservations: Array<Record<string, unknown>> = []
let registrationDeliveryAllowed = true
let registrationContextFailure: Error | null = null
let registrationSignalFailure: Error | null = null
let registrationReservationFailure: Error | null = null
let registrationIssuerFailure: Error | null = null
let registrationIssuerResult: unknown = Object.freeze({ status: "issued" })
const verificationReservations: Array<Record<string, unknown>> = []
let verificationAttemptAllowed = true
let recoveryReceiptCalls = 0

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  if (request === "@supabase/ssr") {
    return {
      createServerClient(
        _url: string,
        _key: string,
        options: {
          cookieOptions: Record<string, unknown>
          cookies: {
            setAll(
              cookies: Array<{
                name: string
                value: string
                options?: Record<string, unknown>
              }>,
            ): void
          }
        },
      ) {
        return {
          auth: {
            async verifyOtp() {
              if (
                verificationError === null &&
                verificationData.user !== null &&
                verificationData.session !== null
              ) {
                options.cookies.setAll([
                  {
                    name: RECOVERY_AUTH_COOKIE,
                    value: "base64-provider-session",
                    options: {
                      path: "/",
                      sameSite: "lax",
                      httpOnly: true,
                      secure: true,
                      maxAge: 400 * 24 * 60 * 60,
                    },
                  },
                ])
              }
              return {
                data: verificationData,
                error: verificationError,
              }
            },
            async getUser() {
              return {
                data: {
                  user: {
                    id: AUTH_USER_ID,
                    email: "sponsor@example.com",
                    email_confirmed_at: "2026-07-20T00:00:00.000Z",
                    is_anonymous: false,
                  },
                },
                error: null,
              }
            },
          },
        }
      },
    }
  }
  if (request === "@/utils/supabase/server") {
    return {
      async createClient() {
        return {
          auth: {
            async signInWithPassword() {
              return {
                data: passwordLoginData,
                error: passwordLoginError,
              }
            },
          },
          from(table: string) {
            if (table === "users") {
              return {
                select() {
                  return {
                    eq() {
                      return {
                        async single() {
                          return { data: null, error: null }
                        },
                      }
                    },
                  }
                },
              }
            }

            return {
              select() {
                return {
                  async eq() {
                    return { data: [], error: null }
                  },
                }
              },
            }
          },
        }
      },
      createServiceRoleClient() {
        return {
          async rpc(name: string) {
            expect(name).toBe("record_sponsor_email_authentication_receipt")
            recoveryReceiptCalls += 1
            return {
              data: [{ receipt_expires_at: "2099-07-20T00:15:00.000Z" }],
              error: null,
            }
          },
        }
      },
    }
  }
  if (request === "@/lib/auth/supabaseEmailProofIssuer") {
    return {
      async issueRegistrationEmailProof(input: Record<string, unknown>) {
        registrationEvents.push("issue")
        registrationIssuerCalls.push(input)
        if (registrationIssuerFailure) throw registrationIssuerFailure
        return registrationIssuerResult
      },
    }
  }
  if (request === "@/lib/sponsorships/management/passwordlessRateLimit") {
    return {
      createSponsorPasswordlessDeliverySignals(input: Record<string, unknown>) {
        registrationEvents.push("signals")
        registrationSignalCalls.push(input)
        if (registrationSignalFailure) throw registrationSignalFailure
        return { recipient: input.email, source: "opaque-source" }
      },
      sponsorPasswordlessDeliveryContext(input: Request) {
        registrationEvents.push("context")
        registrationContextCalls.push(input)
        if (registrationContextFailure) throw registrationContextFailure
        return REGISTRATION_DELIVERY_CONTEXT
      },
      async reserveSponsorPasswordlessDelivery(input: Record<string, unknown>) {
        registrationEvents.push("reserve")
        registrationReservations.push(input)
        if (registrationReservationFailure) {
          throw registrationReservationFailure
        }
        return registrationDeliveryAllowed
      },
      createSponsorPasswordlessVerificationSignals() {
        return {
          sourceDigest: "opaque-verification-source",
          sourceHmacKeyVersion: 1,
        }
      },
      async reserveSponsorPasswordlessVerificationAttempt(
        input: Record<string, unknown>,
      ) {
        verificationReservations.push(input)
        return verificationAttemptAllowed
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/advocates/attribution-identity-session-auth-routes.spec.ts",
  ),
)
const { POST: login } = testRequire(
  "../../src/app/api/auth/login/route",
) as LoginRouteModule
const { POST: verifyOtp } = testRequire(
  "../../src/app/api/auth/verify-otp/route",
) as VerifyOtpRouteModule
const { POST: register } = testRequire(
  "../../src/app/api/auth/registration/route",
) as RegistrationRouteModule
const {
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_MAX_AGE_SECONDS,
  verifyAdvocateAttributionIdentityCookieValue,
} = testRequire(
  "../../src/lib/advocates/attributionIdentityCookie",
) as AttributionIdentityCookieModule
nodeModule._load = originalModuleLoad

function setCookieHeaders(response: Response): string[] {
  return (
    response.headers as Headers & { getSetCookie(): string[] }
  ).getSetCookie()
}

function identityCookie(response: Response): string | undefined {
  return setCookieHeaders(response).find(
    (header) =>
      header.startsWith(`${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`) &&
      !header.includes("Max-Age=0"),
  )
}

function cookieValue(setCookie: string): string {
  return setCookie.slice(setCookie.indexOf("=") + 1, setCookie.indexOf(";"))
}

function expectVerifiedHostOnlyIdentity(
  response: Response,
  expectedUserId: string,
) {
  const setCookie = identityCookie(response)

  expect(setCookie).toBeDefined()
  expect(setCookie).not.toContain("Domain=")
  expect(setCookie).toContain("Path=/")
  expect(setCookie).toContain(
    `Max-Age=${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_MAX_AGE_SECONDS}`,
  )
  expect(setCookie).toContain("HttpOnly")
  expect(setCookie).toContain("Secure")
  expect(setCookie).toContain("SameSite=lax")

  const verification = verifyAdvocateAttributionIdentityCookieValue(
    cookieValue(setCookie!),
    { rawHost: "creatorshare.com" },
  )
  expect(verification?.signal.authUserId).toBe(expectedUserId)
}

function jsonRequest(path: string, body: Record<string, unknown>): Request {
  return new Request(`https://creatorshare.com${path}`, {
    method: "POST",
    headers: {
      host: "creatorshare.com",
      origin: "https://creatorshare.com",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

function recoveryVerificationRequest(): NextRequest {
  return new NextRequest("https://creatorshare.com/api/auth/verify-otp", {
    method: "POST",
    headers: {
      host: "creatorshare.com",
      origin: "https://creatorshare.com",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      email: "sponsor@example.com",
      token: "123456",
      type: "recovery",
    }),
  })
}

function loginRequest(): Request {
  return jsonRequest("/api/auth/login", {
    email: "sponsor@example.com",
    password: "correct horse battery staple",
  })
}

function registrationRequest(overrides: Record<string, unknown> = {}): Request {
  return jsonRequest("/api/auth/registration", {
    email: "sponsor@example.com",
    password: "CorrectHorse1!",
    first_name: "Sponsor",
    last_name: "Family",
    ...overrides,
  })
}

async function expectRegistrationAccepted(
  response: Response,
  forbiddenText: readonly string[] = [],
): Promise<void> {
  expect(response.status).toBe(202)
  const body = (await response.json()) as Record<string, unknown>
  expect(body).toEqual({ status: "check-email" })
  const serializedBody = JSON.stringify(body)
  const serializedHeaders = JSON.stringify([...response.headers.entries()])
  for (const value of forbiddenText) {
    expect(serializedBody).not.toContain(value)
    expect(serializedHeaders).not.toContain(value)
  }
  expect(response.headers.get("cache-control")).toBe("no-store, max-age=0")
  expect(response.headers.get("pragma")).toBe("no-cache")
  expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  expect(response.headers.get("x-content-type-options")).toBe("nosniff")
  expect(response.headers.get("retry-after")).toBeNull()
  expect(setCookieHeaders(response)).toEqual([])
  expect(identityCookie(response)).toBeUndefined()
}

function clearRegistrationObservations(): void {
  registrationEvents.length = 0
  registrationContextCalls.length = 0
  registrationSignalCalls.length = 0
  registrationIssuerCalls.length = 0
  registrationReservations.length = 0
}

test.beforeEach(() => {
  process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1 = CURRENT_SECRET
  process.env.NEXT_PUBLIC_BASE_URL = CANONICAL_ORIGIN
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key"
  process.env.NEXT_SERVICE_ROLE_KEY = "service-role-key"
  passwordLoginData = { user: { id: AUTH_USER_ID } }
  passwordLoginError = null
  verificationData = {
    user: { id: AUTH_USER_ID },
    session: {
      access_token: recoveryAccessToken(),
      refresh_token: "opaque-refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      user: { id: AUTH_USER_ID },
    },
  }
  verificationError = null
  registrationEvents.length = 0
  registrationContextCalls.length = 0
  registrationSignalCalls.length = 0
  registrationIssuerCalls.length = 0
  registrationReservations.length = 0
  registrationDeliveryAllowed = true
  registrationContextFailure = null
  registrationSignalFailure = null
  registrationReservationFailure = null
  registrationIssuerFailure = null
  registrationIssuerResult = Object.freeze({ status: "issued" })
  verificationReservations.length = 0
  verificationAttemptAllowed = true
  recoveryReceiptCalls = 0
})

test.afterAll(() => {
  for (const [name, value] of Object.entries(PREVIOUS_ENVIRONMENT)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test("successful password login issues a verified host-only identity signal", async () => {
  const response = await login(loginRequest())

  expect(response.status).toBe(200)
  expectVerifiedHostOnlyIdentity(response, AUTH_USER_ID)
})

test("failed password login does not issue an identity signal", async () => {
  passwordLoginData = { user: null }
  passwordLoginError = { message: "Invalid credentials" }

  const response = await login(loginRequest())

  expect(response.status).toBe(401)
  expect(identityCookie(response)).toBeUndefined()
})

test("successful recovery verification issues a verified host-only identity signal", async () => {
  const response = await verifyOtp(recoveryVerificationRequest())

  expect(response.status).toBe(200)
  expect(recoveryReceiptCalls).toBe(1)
  const authCookie = setCookieHeaders(response).find((header) =>
    header.startsWith(`${RECOVERY_AUTH_COOKIE}=`),
  )
  expect(authCookie).toBeDefined()
  expect(authCookie).not.toContain("Domain=")
  expect(authCookie).toContain("Secure")
  expect(authCookie).toContain("HttpOnly")
  expect(authCookie).toContain("Max-Age=900")
  expectVerifiedHostOnlyIdentity(response, AUTH_USER_ID)
})

test("failed or malformed recovery verification does not issue an identity signal", async () => {
  verificationData = { user: null, session: null }
  verificationError = { message: "Invalid token" }

  const failedResponse = await verifyOtp(recoveryVerificationRequest())
  expect(failedResponse.status).toBe(400)
  expect(identityCookie(failedResponse)).toBeUndefined()

  verificationError = null
  const userlessResponse = await verifyOtp(recoveryVerificationRequest())
  expect(userlessResponse.status).toBe(503)
  expect(identityCookie(userlessResponse)).toBeUndefined()
})

test("registration normalizes one identity across quota and issuance", async () => {
  const password = "  CorrectHorse1!  "
  const request = registrationRequest({
    email: " Sponsor+Family@Example.com ",
    first_name: "  Sponsor   Grace ",
    last_name: " Family   Name ",
    password,
  })
  const response = await register(request)

  await expectRegistrationAccepted(response, [password])
  expect(registrationEvents).toEqual(["context", "signals", "reserve", "issue"])
  expect(registrationContextCalls).toEqual([request])
  expect(registrationSignalCalls).toHaveLength(1)
  expect(registrationSignalCalls[0].email).toBe("sponsor+family@example.com")
  expect(registrationSignalCalls[0].headers).toBe(request.headers)
  expect(registrationReservations).toHaveLength(1)
  expect(registrationReservations[0]).toEqual({
    flow: "registration",
    signals: {
      recipient: "sponsor+family@example.com",
      source: "opaque-source",
    },
    context: REGISTRATION_DELIVERY_CONTEXT,
  })
  expect(registrationReservations[0].context).toBe(
    REGISTRATION_DELIVERY_CONTEXT,
  )
  expect(JSON.stringify(registrationSignalCalls)).not.toContain(password)
  expect(JSON.stringify(registrationReservations)).not.toContain(password)
  expect(JSON.stringify(REGISTRATION_DELIVERY_CONTEXT)).not.toContain(password)
  expect(registrationIssuerCalls).toEqual([
    {
      recipientEmail: "sponsor+family@example.com",
      redirectTo:
        "https://creatorshare.com/auth/confirm?next=%2Fapp%2Fmain%2Fonboarding",
      context: REGISTRATION_DELIVERY_CONTEXT,
      password,
      firstName: "Sponsor Grace",
      lastName: "Family Name",
    },
  ])
  expect(registrationIssuerCalls[0].recipientEmail).toBe(
    registrationSignalCalls[0].email,
  )
  expect(registrationIssuerCalls[0].context).toBe(
    registrationReservations[0].context,
  )
  expect(registrationIssuerCalls[0].redirectTo).not.toContain(password)
})

test("registration issues confirmation mail only from the exact canonical origin", async () => {
  const body = JSON.stringify({
    email: "sponsor@example.com",
    password: "CorrectHorse1!",
    first_name: "Sponsor",
    last_name: "Family",
  })
  const requests = [
    new Request("https://www.creatorshare.com/api/auth/registration", {
      method: "POST",
      headers: {
        host: "www.creatorshare.com",
        origin: "https://www.creatorshare.com",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
      body,
    }),
    new Request("https://creatorshare.com/api/auth/registration", {
      method: "POST",
      headers: {
        host: "creatorshare.com",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
        "content-type": "application/json",
      },
      body,
    }),
  ]

  for (const request of requests) {
    const response = await register(request)
    expect(response.status).toBe(400)
  }
  expect(registrationEvents).toEqual([])
  expect(registrationContextCalls).toHaveLength(0)
  expect(registrationSignalCalls).toHaveLength(0)
  expect(registrationReservations).toHaveLength(0)
  expect(registrationIssuerCalls).toHaveLength(0)
})

test("registration preserves exact profile and password validation", async () => {
  const requests = [
    registrationRequest({ email: "not-an-email" }),
    registrationRequest({ first_name: " " }),
    registrationRequest({ last_name: "Family\u0000Name" }),
    registrationRequest({ password: "weak" }),
    registrationRequest({ password: `A1!a${"x".repeat(253)}` }),
    registrationRequest({ unexpected: true }),
  ]

  for (const request of requests) {
    const response = await register(request)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "invalid-request",
    })
  }
  expect(registrationEvents).toEqual([])
  expect(registrationIssuerCalls).toHaveLength(0)
})

test("registration hides context, signal, and quota outcomes", async () => {
  registrationContextFailure = new Error(
    "context failed for private-sponsor@example.com",
  )
  const contextFailure = await register(registrationRequest())
  await expectRegistrationAccepted(contextFailure, [
    "private-sponsor@example.com",
    "context failed",
  ])
  expect(registrationEvents).toEqual(["context"])
  expect(registrationSignalCalls).toHaveLength(0)
  expect(registrationReservations).toHaveLength(0)
  expect(registrationIssuerCalls).toHaveLength(0)

  clearRegistrationObservations()
  registrationContextFailure = null
  registrationSignalFailure = new Error(
    "signal failed for private-sponsor@example.com",
  )
  const signalFailure = await register(registrationRequest())
  await expectRegistrationAccepted(signalFailure, [
    "private-sponsor@example.com",
    "signal failed",
  ])
  expect(registrationEvents).toEqual(["context", "signals"])
  expect(registrationReservations).toHaveLength(0)
  expect(registrationIssuerCalls).toHaveLength(0)

  clearRegistrationObservations()
  registrationSignalFailure = null
  registrationDeliveryAllowed = false
  const denied = await register(registrationRequest())
  await expectRegistrationAccepted(denied, ["sponsor@example.com"])
  expect(registrationEvents).toEqual(["context", "signals", "reserve"])
  expect(registrationIssuerCalls).toHaveLength(0)

  clearRegistrationObservations()
  registrationDeliveryAllowed = true
  registrationReservationFailure = new Error(
    "quota failed for private-sponsor@example.com",
  )
  const reservationFailure = await register(registrationRequest())
  await expectRegistrationAccepted(reservationFailure, [
    "private-sponsor@example.com",
    "quota failed",
  ])
  expect(registrationEvents).toEqual(["context", "signals", "reserve"])
  expect(registrationIssuerCalls).toHaveLength(0)
})

test("registration hides every issuer disposition and exception", async () => {
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
    registrationIssuerResult = disposition
    const response = await register(registrationRequest())
    await expectRegistrationAccepted(response, [
      "sponsor@example.com",
      disposition.status,
      "retryAfterSeconds",
      "provider secret",
    ])
  }

  registrationIssuerFailure = new Error(
    "provider failed for sponsor@example.com with provider secret",
  )
  const exception = await register(registrationRequest())
  await expectRegistrationAccepted(exception, [
    "sponsor@example.com",
    "provider failed",
    "provider secret",
  ])
  expect(registrationIssuerCalls).toHaveLength(dispositions.length + 1)
})

test("registration confirmation uses a fixed contact-free route", () => {
  const registrationPage = readFileSync(
    resolve(process.cwd(), "src/app/register/page.tsx"),
    "utf8",
  )
  const confirmationPage = readFileSync(
    resolve(process.cwd(), "src/app/verifyAccount/page.tsx"),
    "utf8",
  )

  expect(registrationPage).toContain('router.push("/verifyAccount")')
  expect(registrationPage).not.toContain("encodeURIComponent(email)")
  expect(registrationPage).not.toContain("/verifyAccount/${")
  expect(confirmationPage).not.toContain("registrationEmail")
  expect(confirmationPage).not.toContain("params")
})
