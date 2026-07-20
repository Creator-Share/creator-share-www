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

const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111"
const CURRENT_SECRET = Buffer.alloc(32, 13).toString("base64")
const CANONICAL_ORIGIN = "https://creatorshare.com"
const PREVIOUS_IDENTITY_SECRET =
  process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1
const PREVIOUS_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL

let passwordLoginData: { user: AuthUser | null } = {
  user: { id: AUTH_USER_ID },
}
let passwordLoginError: { message: string } | null = null
let verificationData: { user: AuthUser | null } = {
  user: { id: AUTH_USER_ID },
}
let verificationError: { message: string } | null = null
let registrationData: {
  session: Record<string, unknown> | null
  user: AuthUser | null
} = {
  session: { access_token: "opaque-session" },
  user: { id: AUTH_USER_ID, identities: [{}] },
}
let registrationError: { message: string } | null = null
const registrationCalls: Array<Record<string, unknown>> = []
const registrationReservations: Array<Record<string, unknown>> = []
let registrationDeliveryAllowed = true

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
        return {
          auth: {
            async signInWithPassword() {
              return {
                data: passwordLoginData,
                error: passwordLoginError,
              }
            },
            async verifyOtp() {
              return {
                data: verificationData,
                error: verificationError,
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
    }
  }
  if (request === "@/lib/sponsorships/management/statelessAuth") {
    return {
      createStatelessSponsorEmailAuthClient() {
        return {
          auth: {
            async signUp(input: Record<string, unknown>) {
              registrationCalls.push(input)
              return {
                data: registrationData,
                error: registrationError,
              }
            },
          },
        }
      },
    }
  }
  if (request === "@/lib/sponsorships/management/passwordlessRateLimit") {
    return {
      createSponsorPasswordlessDeliverySignals(input: Record<string, unknown>) {
        return { recipient: input.email, source: "opaque-source" }
      },
      sponsorPasswordlessDeliveryContext() {
        return { requestId: "registration-request", traceId: null }
      },
      async reserveSponsorPasswordlessDelivery(input: Record<string, unknown>) {
        registrationReservations.push(input)
        return registrationDeliveryAllowed
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

function registrationRequest(): Request {
  return jsonRequest("/api/auth/registration", {
    email: "sponsor@example.com",
    password: "CorrectHorse1!",
    first_name: "Sponsor",
    last_name: "Family",
  })
}

test.beforeEach(() => {
  process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1 = CURRENT_SECRET
  process.env.NEXT_PUBLIC_BASE_URL = CANONICAL_ORIGIN
  passwordLoginData = { user: { id: AUTH_USER_ID } }
  passwordLoginError = null
  verificationData = { user: { id: AUTH_USER_ID } }
  verificationError = null
  registrationData = {
    session: { access_token: "opaque-session" },
    user: { id: AUTH_USER_ID, identities: [{}] },
  }
  registrationError = null
  registrationCalls.length = 0
  registrationReservations.length = 0
  registrationDeliveryAllowed = true
})

test.afterAll(() => {
  if (PREVIOUS_IDENTITY_SECRET === undefined) {
    delete process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1
  } else {
    process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1 =
      PREVIOUS_IDENTITY_SECRET
  }
  if (PREVIOUS_BASE_URL === undefined) {
    delete process.env.NEXT_PUBLIC_BASE_URL
  } else {
    process.env.NEXT_PUBLIC_BASE_URL = PREVIOUS_BASE_URL
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
  expectVerifiedHostOnlyIdentity(response, AUTH_USER_ID)
})

test("failed or userless recovery verification does not issue an identity signal", async () => {
  verificationData = { user: null }
  verificationError = { message: "Invalid token" }

  const failedResponse = await verifyOtp(recoveryVerificationRequest())
  expect(failedResponse.status).toBe(400)
  expect(identityCookie(failedResponse)).toBeUndefined()

  verificationError = null
  const userlessResponse = await verifyOtp(recoveryVerificationRequest())
  expect(userlessResponse.status).toBe(200)
  expect(identityCookie(userlessResponse)).toBeUndefined()
})

test("registration reserves delivery and never releases an unconfirmed provider session", async () => {
  const response = await register(registrationRequest())

  expect(response.status).toBe(202)
  await expect(response.json()).resolves.toEqual({ status: "check-email" })
  expect(identityCookie(response)).toBeUndefined()
  expect(registrationReservations).toHaveLength(1)
  expect(registrationReservations[0]).toMatchObject({
    flow: "registration",
    signals: {
      recipient: "sponsor@example.com",
      source: "opaque-source",
    },
  })
  expect(registrationCalls).toEqual([
    {
      email: "sponsor@example.com",
      password: "CorrectHorse1!",
      options: {
        data: {
          first_name: "Sponsor",
          last_name: "Family",
        },
        emailRedirectTo:
          "https://creatorshare.com/auth/confirm?next=%2Fapp%2Fmain%2Fonboarding",
      },
    },
  ])
})

test("registration issues confirmation mail only from the exact canonical origin", async () => {
  const body = JSON.stringify({
    email: "sponsor@example.com",
    password: "correct horse battery staple",
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
  expect(registrationCalls).toHaveLength(0)
})

test("registration hides existing accounts, provider failures, and delivery denial", async () => {
  registrationData = { session: null, user: null }
  registrationError = { message: "User already registered: provider secret" }
  const providerFailure = await register(registrationRequest())
  expect(providerFailure.status).toBe(202)
  await expect(providerFailure.json()).resolves.toEqual({
    status: "check-email",
  })
  expect(identityCookie(providerFailure)).toBeUndefined()

  registrationCalls.length = 0
  registrationDeliveryAllowed = false
  const denied = await register(registrationRequest())
  expect(denied.status).toBe(202)
  await expect(denied.json()).resolves.toEqual({ status: "check-email" })
  expect(registrationCalls).toHaveLength(0)
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
