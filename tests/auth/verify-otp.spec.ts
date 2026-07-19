import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import type { NextRequest } from "next/server"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown
type VerifyOtpRouteModule =
  typeof import("../../src/app/api/auth/verify-otp/route")

const verifyOtpCalls: Array<Record<string, unknown>> = []
let createClientCalls = 0
let providerError: { message: string } | null = null
let providerFailure: Error | null = null

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
        return {
          auth: {
            async verifyOtp(input: Record<string, unknown>) {
              verifyOtpCalls.push(input)
              if (providerFailure) throw providerFailure
              return { data: { user: null }, error: providerError }
            },
          },
        }
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}
const testRequire = createRequire(
  resolve(process.cwd(), "tests/auth/verify-otp.spec.ts"),
)
const verifyOtpRoutePath = testRequire.resolve(
  "../../src/app/api/auth/verify-otp/route",
)
delete testRequire.cache[verifyOtpRoutePath]
const { POST } = testRequire(verifyOtpRoutePath) as VerifyOtpRouteModule
delete testRequire.cache[verifyOtpRoutePath]
nodeModule._load = originalModuleLoad

const ORIGIN = "https://creatorshare.com"
const MAXIMUM_VERIFY_OTP_BODY_BYTES = 1024
const VALID_BODY = JSON.stringify({
  email: " Sponsor+Family@Example.com ",
  token: "123456",
  type: "recovery",
})

function requestFor(
  body: string,
  headerOverrides: Record<string, string | null> = {},
): NextRequest {
  const headers = new Headers({
    host: "creatorshare.com",
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json; charset=utf-8",
  })
  for (const [name, value] of Object.entries(headerOverrides)) {
    if (value === null) headers.delete(name)
    else headers.set(name, value)
  }

  return new Request(`${ORIGIN}/api/auth/verify-otp`, {
    method: "POST",
    headers,
    body,
  }) as unknown as NextRequest
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

test.beforeEach(() => {
  verifyOtpCalls.length = 0
  createClientCalls = 0
  providerError = null
  providerFailure = null
})

test("rejects cross-site and cross-subdomain requests before authentication", async () => {
  const hostileOrigin = await POST(
    requestFor(VALID_BODY, {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    }),
  )
  const crossSubdomain = await POST(
    requestFor(VALID_BODY, {
      origin: "https://hope.creatorshare.com",
    }),
  )
  const contradictoryFetchMetadata = await POST(
    requestFor(VALID_BODY, {
      "sec-fetch-site": "cross-site",
    }),
  )
  const missingOrigin = await POST(requestFor(VALID_BODY, { origin: null }))

  for (const response of [
    hostileOrigin,
    crossSubdomain,
    contradictoryFetchMetadata,
    missingOrigin,
  ]) {
    expect(response.status).toBe(400)
    expect(await bodyOf(response)).toEqual({ error: "invalid-request" })
  }
  expect(createClientCalls).toBe(0)
  expect(verifyOtpCalls).toHaveLength(0)
})

test("requires JSON content type before reading or authenticating", async () => {
  for (const contentType of [
    "text/plain",
    "application/x-www-form-urlencoded",
  ]) {
    const response = await POST(
      requestFor(VALID_BODY, { "content-type": contentType }),
    )
    expect(response.status).toBe(400)
    expect(await bodyOf(response)).toEqual({ error: "invalid-request" })
  }

  expect(createClientCalls).toBe(0)
  expect(verifyOtpCalls).toHaveLength(0)
})

test("allows only the fixed recovery OTP type", async () => {
  for (const type of ["signup", "magiclink", "email_change", "email", null]) {
    const payload: Record<string, unknown> = {
      email: "sponsor@example.com",
      token: "123456",
      type,
    }
    if (type === null) delete payload.type

    const response = await POST(requestFor(JSON.stringify(payload)))
    expect(response.status).toBe(400)
    expect(await bodyOf(response)).toEqual({ error: "invalid-request" })
  }

  expect(createClientCalls).toBe(0)
  expect(verifyOtpCalls).toHaveLength(0)
})

test("rejects oversized declared and streamed bodies", async () => {
  const declaredOversize = await POST(
    requestFor(VALID_BODY, {
      "content-length": String(MAXIMUM_VERIFY_OTP_BODY_BYTES + 1),
    }),
  )
  const streamedOversize = await POST(
    requestFor("x".repeat(MAXIMUM_VERIFY_OTP_BODY_BYTES + 1)),
  )
  const malformedLength = await POST(
    requestFor(VALID_BODY, { "content-length": "unknown" }),
  )

  for (const response of [
    declaredOversize,
    streamedOversize,
    malformedLength,
  ]) {
    expect(response.status).toBe(400)
    expect(await bodyOf(response)).toEqual({ error: "invalid-request" })
  }
  expect(createClientCalls).toBe(0)
  expect(verifyOtpCalls).toHaveLength(0)
})

test("rejects malformed JSON and invalid or unbounded fields", async () => {
  const malformedBodies = [
    "not-json",
    "[]",
    JSON.stringify({
      email: "not-an-email",
      token: "123456",
      type: "recovery",
    }),
    JSON.stringify({
      email: "sponsor@example.com",
      token: "12345",
      type: "recovery",
    }),
    JSON.stringify({
      email: "sponsor@example.com",
      token: "12345a",
      type: "recovery",
    }),
    JSON.stringify({
      email: "sponsor@example.com",
      token: 123456,
      type: "recovery",
    }),
    JSON.stringify({
      email: "sponsor@example.com",
      token: "123456",
      type: "recovery",
      redirectTo: "https://attacker.example",
    }),
    JSON.stringify({
      email: `${"a".repeat(65)}@example.com`,
      token: "123456",
      type: "recovery",
    }),
  ]

  for (const body of malformedBodies) {
    const response = await POST(requestFor(body))
    expect(response.status).toBe(400)
    expect(await bodyOf(response)).toEqual({ error: "invalid-request" })
  }
  expect(createClientCalls).toBe(0)
  expect(verifyOtpCalls).toHaveLength(0)
})

test("verifies a valid recovery code with normalized bounded input", async () => {
  const response = await POST(requestFor(VALID_BODY))

  expect(response.status).toBe(200)
  expect(await bodyOf(response)).toEqual({
    message: "OTP verified successfully.",
  })
  expect(response.headers.get("cache-control")).toBe("no-store, max-age=0")
  expect(createClientCalls).toBe(1)
  expect(verifyOtpCalls).toEqual([
    {
      email: "sponsor+family@example.com",
      token: "123456",
      type: "recovery",
    },
  ])
})

test("does not expose provider or exception details", async () => {
  providerError = { message: "sensitive provider account detail" }
  const providerResponse = await POST(requestFor(VALID_BODY))
  expect(providerResponse.status).toBe(400)
  expect(await bodyOf(providerResponse)).toEqual({
    error: "verification-failed",
  })

  providerError = null
  providerFailure = new Error("sensitive infrastructure detail")
  const unavailableResponse = await POST(requestFor(VALID_BODY))
  expect(unavailableResponse.status).toBe(503)
  expect(await bodyOf(unavailableResponse)).toEqual({
    error: "verification-unavailable",
  })
})
