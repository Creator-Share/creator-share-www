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
type PasswordResetRouteModule =
  typeof import("../../src/app/api/auth/reset-password/route")

const ORIGIN = "https://creatorshare.com"
const MAXIMUM_BODY_BYTES = 1024
const PREVIOUS_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL

const deliveryContext = Object.freeze({
  requestId: "71000000-0000-4000-8000-000000000001",
  traceId: null,
})
const events: string[] = []
const signalCalls: Array<Record<string, unknown>> = []
const contextCalls: Request[] = []
const reservationCalls: Array<Record<string, unknown>> = []
const issuerCalls: Array<Record<string, unknown>> = []

let contextFailure: Error | null = null
let signalFailure: Error | null = null
let reservationFailure: Error | null = null
let reservationAllowed = true
let issuerFailure: Error | null = null
let issuerResult: unknown = Object.freeze({ status: "issued" })

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
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
        return Object.freeze({
          recipientDigest: `recipient:${String(input.email)}`,
          sourceDigest: "source:trusted",
        })
      },
      async reserveSponsorPasswordlessDelivery(input: Record<string, unknown>) {
        events.push("reserve")
        reservationCalls.push(input)
        if (reservationFailure) throw reservationFailure
        return reservationAllowed
      },
    }
  }
  if (request === "@/lib/auth/supabaseEmailProofIssuer") {
    return {
      async issuePasswordResetEmailProof(input: Record<string, unknown>) {
        events.push("issue")
        issuerCalls.push(input)
        if (issuerFailure) throw issuerFailure
        return issuerResult
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(process.cwd(), "tests/auth/password-reset-request-route.spec.ts"),
)
const routePath = testRequire.resolve(
  "../../src/app/api/auth/reset-password/route",
)
delete testRequire.cache[routePath]
const { POST, dynamic, runtime } = testRequire(
  routePath,
) as PasswordResetRouteModule
delete testRequire.cache[routePath]
nodeModule._load = originalModuleLoad

function requestFor(
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

  return new NextRequest(`https://${host}/api/auth/reset-password`, {
    method: "POST",
    headers,
    body: serializedBody,
  })
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

function expectPrivacyHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store, max-age=0")
  expect(response.headers.get("pragma")).toBe("no-cache")
  expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  expect(response.headers.get("x-content-type-options")).toBe("nosniff")
}

async function expectCheckEmailResponse(
  response: Response,
  forbiddenText: readonly string[] = [],
): Promise<void> {
  expect(response.status).toBe(202)
  const body = await bodyOf(response)
  expect(body).toEqual({ status: "check-email" })
  const serialized = JSON.stringify(body)
  for (const value of forbiddenText) expect(serialized).not.toContain(value)
  expectPrivacyHeaders(response)
}

test.beforeEach(() => {
  process.env.NEXT_PUBLIC_BASE_URL = ORIGIN
  events.length = 0
  signalCalls.length = 0
  contextCalls.length = 0
  reservationCalls.length = 0
  issuerCalls.length = 0
  contextFailure = null
  signalFailure = null
  reservationFailure = null
  reservationAllowed = true
  issuerFailure = null
  issuerResult = Object.freeze({ status: "issued" })
})

test.afterAll(() => {
  if (PREVIOUS_BASE_URL === undefined) {
    delete process.env.NEXT_PUBLIC_BASE_URL
  } else {
    process.env.NEXT_PUBLIC_BASE_URL = PREVIOUS_BASE_URL
  }
})

test("pins password reset requests to the dynamic Node runtime", () => {
  expect(runtime).toBe("nodejs")
  expect(dynamic).toBe("force-dynamic")
})

test("rejects nonprimary and untrusted requests before quota work", async () => {
  const body = JSON.stringify({ email: "sponsor@example.com" })
  const requests = [
    requestFor(body, {
      origin: "https://attacker.example",
      fetchSite: "cross-site",
    }),
    requestFor(body, { host: "hope.creatorshare.com" }),
    requestFor(body, { host: "www.creatorshare.com" }),
    requestFor(body, { host: "creator-share-www.vercel.app" }),
    requestFor(body, { origin: null }),
    requestFor(body, { fetchSite: "cross-site" }),
    requestFor(body, { contentType: "text/plain" }),
    requestFor(body, { contentType: null }),
  ]

  for (const request of requests) {
    const response = await POST(request)
    expect(response.status).toBe(400)
    expect(await bodyOf(response)).toEqual({ error: "invalid-request" })
    expectPrivacyHeaders(response)
  }

  expect(events).toEqual([])
  expect(reservationCalls).toEqual([])
  expect(issuerCalls).toEqual([])
})

test("rejects oversized, malformed, and expanded bodies before quota work", async () => {
  const validBody = JSON.stringify({ email: "sponsor@example.com" })
  const requests = [
    requestFor(validBody, {
      contentLength: String(MAXIMUM_BODY_BYTES + 1),
    }),
    requestFor(validBody, { contentLength: "unknown" }),
    requestFor("x".repeat(MAXIMUM_BODY_BYTES + 1)),
    requestFor("not-json"),
    requestFor("[]"),
    requestFor(JSON.stringify({})),
    requestFor(JSON.stringify({ email: "not-an-email" })),
    requestFor(JSON.stringify({ email: 42 })),
    requestFor(
      JSON.stringify({
        email: "sponsor@example.com",
        redirectTo: "https://attacker.example/collect",
      }),
    ),
    requestFor(
      JSON.stringify({ email: "sponsor@example.com", password: "secret" }),
    ),
  ]

  for (const request of requests) {
    const response = await POST(request)
    expect(response.status).toBe(400)
    expect(await bodyOf(response)).toEqual({ error: "invalid-request" })
    expectPrivacyHeaders(response)
  }

  expect(events).toEqual([])
  expect(reservationCalls).toEqual([])
  expect(issuerCalls).toEqual([])
})

test("returns one generic unavailable response for invalid canonical configuration", async () => {
  process.env.NEXT_PUBLIC_BASE_URL = "not a canonical origin"

  const response = await POST(
    requestFor(JSON.stringify({ email: "sponsor@example.com" })),
  )

  expect(response.status).toBe(503)
  expect(await bodyOf(response)).toEqual({ error: "unavailable" })
  expectPrivacyHeaders(response)
  expect(events).toEqual([])
})

test("reserves quota before issuance with one normalized identity and context", async () => {
  const request = requestFor(
    JSON.stringify({ email: " Sponsor+Family@Example.com " }),
  )

  const response = await POST(request)

  await expectCheckEmailResponse(response)
  expect(events).toEqual(["context", "signals", "reserve", "issue"])
  expect(contextCalls).toEqual([request])
  expect(signalCalls).toHaveLength(1)
  expect(signalCalls[0].email).toBe("sponsor+family@example.com")
  expect(signalCalls[0].headers).toBe(request.headers)
  expect(reservationCalls).toHaveLength(1)
  expect(reservationCalls[0].flow).toBe("password-reset")
  expect(reservationCalls[0].context).toBe(deliveryContext)
  expect(issuerCalls).toHaveLength(1)
  expect(issuerCalls[0]).toEqual({
    recipientEmail: "sponsor+family@example.com",
    context: deliveryContext,
  })
  expect(issuerCalls[0].context).toBe(reservationCalls[0].context)
})

test("hides suppressed quota and every quota infrastructure failure", async () => {
  reservationAllowed = false
  const suppressed = await POST(
    requestFor(JSON.stringify({ email: "suppressed@example.com" })),
  )
  await expectCheckEmailResponse(suppressed, ["suppressed@example.com"])
  expect(events).toEqual(["context", "signals", "reserve"])
  expect(issuerCalls).toEqual([])

  events.length = 0
  reservationAllowed = true
  reservationFailure = new Error(
    "quota database leaked sponsor@example.com and provider details",
  )
  const reservationUnavailable = await POST(
    requestFor(JSON.stringify({ email: "sponsor@example.com" })),
  )
  await expectCheckEmailResponse(reservationUnavailable, [
    "sponsor@example.com",
    "provider details",
  ])
  expect(events).toEqual(["context", "signals", "reserve"])
  expect(issuerCalls).toEqual([])

  events.length = 0
  reservationFailure = null
  signalFailure = new Error("recipient digest unavailable")
  const signalsUnavailable = await POST(
    requestFor(JSON.stringify({ email: "sponsor@example.com" })),
  )
  await expectCheckEmailResponse(signalsUnavailable, ["sponsor@example.com"])
  expect(events).toEqual(["context", "signals"])
  expect(reservationCalls).toHaveLength(2)
  expect(issuerCalls).toEqual([])

  events.length = 0
  signalFailure = null
  contextFailure = new Error("request identifier unavailable")
  const contextUnavailable = await POST(
    requestFor(JSON.stringify({ email: "sponsor@example.com" })),
  )
  await expectCheckEmailResponse(contextUnavailable, ["sponsor@example.com"])
  expect(events).toEqual(["context"])
  expect(issuerCalls).toEqual([])
})

test("returns one privacy response for every issuer disposition and exception", async () => {
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
    const email = `sponsor${index}@example.com`
    const response = await POST(requestFor(JSON.stringify({ email })))
    await expectCheckEmailResponse(response, [
      email,
      disposition.status,
      "retryAfterSeconds",
    ])
  }

  issuerFailure = new Error(
    "provider failed for private-sponsor@example.com with secret detail",
  )
  const exception = await POST(
    requestFor(JSON.stringify({ email: "private-sponsor@example.com" })),
  )
  await expectCheckEmailResponse(exception, [
    "private-sponsor@example.com",
    "secret detail",
    "provider failed",
  ])

  expect(issuerCalls).toHaveLength(dispositions.length + 1)
  expect(reservationCalls).toHaveLength(dispositions.length + 1)
  const reserveIndexes = events.flatMap((event, index) =>
    event === "reserve" ? [index] : [],
  )
  const issueIndexes = events.flatMap((event, index) =>
    event === "issue" ? [index] : [],
  )
  expect(reserveIndexes).toHaveLength(issueIndexes.length)
  for (const [index, issueIndex] of issueIndexes.entries()) {
    expect(reserveIndexes[index]).toBeLessThan(issueIndex)
  }
})
