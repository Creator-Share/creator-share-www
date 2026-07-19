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
const PREVIOUS_IDENTITY_SECRET =
  process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1

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
            async signUp() {
              return {
                data: registrationData,
                error: registrationError,
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
  return setCookieHeaders(response).find((header) =>
    header.startsWith(`${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=`),
  )
}

function cookieValue(setCookie: string): string {
  return setCookie.slice(setCookie.indexOf("=") + 1, setCookie.indexOf(";"))
}

function expectVerifiedParentDomainIdentity(
  response: Response,
  expectedUserId: string,
) {
  const setCookie = identityCookie(response)

  expect(setCookie).toBeDefined()
  expect(setCookie).toContain("Domain=.creatorshare.com")
  expect(setCookie).toContain("Path=/")
  expect(setCookie).toContain(
    `Max-Age=${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_MAX_AGE_SECONDS}`,
  )
  expect(setCookie).toContain("HttpOnly")
  expect(setCookie).toContain("Secure")
  expect(setCookie).toContain("SameSite=lax")

  const verification = verifyAdvocateAttributionIdentityCookieValue(
    cookieValue(setCookie!),
  )
  expect(verification?.signal.authUserId).toBe(expectedUserId)
}

function jsonRequest(path: string, body: Record<string, unknown>): Request {
  return new Request(`https://creatorshare.com${path}`, {
    method: "POST",
    headers: {
      host: "creatorshare.com",
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
    password: "correct horse battery staple",
    first_name: "Sponsor",
    last_name: "Family",
  })
}

test.beforeEach(() => {
  process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1 = CURRENT_SECRET
  passwordLoginData = { user: { id: AUTH_USER_ID } }
  passwordLoginError = null
  verificationData = { user: { id: AUTH_USER_ID } }
  verificationError = null
  registrationData = {
    session: { access_token: "opaque-session" },
    user: { id: AUTH_USER_ID, identities: [{}] },
  }
  registrationError = null
})

test.afterAll(() => {
  if (PREVIOUS_IDENTITY_SECRET === undefined) {
    delete process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1
  } else {
    process.env.ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1 =
      PREVIOUS_IDENTITY_SECRET
  }
})

test("successful password login issues a verified parent-domain identity signal", async () => {
  const response = await login(loginRequest())

  expect(response.status).toBe(200)
  expectVerifiedParentDomainIdentity(response, AUTH_USER_ID)
})

test("failed password login does not issue an identity signal", async () => {
  passwordLoginData = { user: null }
  passwordLoginError = { message: "Invalid credentials" }

  const response = await login(loginRequest())

  expect(response.status).toBe(401)
  expect(identityCookie(response)).toBeUndefined()
})

test("successful recovery verification issues a verified parent-domain identity signal", async () => {
  const response = await verifyOtp(recoveryVerificationRequest())

  expect(response.status).toBe(200)
  expectVerifiedParentDomainIdentity(response, AUTH_USER_ID)
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

test("registration with an immediate session and user issues a verified parent-domain identity signal", async () => {
  const response = await register(registrationRequest())

  expect(response.status).toBe(201)
  expectVerifiedParentDomainIdentity(response, AUTH_USER_ID)
})

test("registration awaiting confirmation or missing a user does not issue an identity signal", async () => {
  registrationData = {
    session: null,
    user: { id: AUTH_USER_ID, identities: [{}] },
  }
  const confirmationPendingResponse = await register(registrationRequest())
  expect(confirmationPendingResponse.status).toBe(201)
  expect(identityCookie(confirmationPendingResponse)).toBeUndefined()

  registrationData = {
    session: { access_token: "opaque-session" },
    user: null,
  }
  const userlessResponse = await register(registrationRequest())
  expect(userlessResponse.status).toBe(201)
  expect(identityCookie(userlessResponse)).toBeUndefined()
})
