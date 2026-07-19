import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown
type RateLimitModule =
  typeof import("../../src/lib/sponsorships/management/passwordlessRateLimit")

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
  resolve(process.cwd(), "tests/sponsorships/passwordless-rate-limit.spec.ts"),
)
const rateLimit = testRequire(
  "../../src/lib/sponsorships/management/passwordlessRateLimit",
) as RateLimitModule
nodeModule._load = originalModuleLoad

const environment = {
  VERCEL: "1",
  SPONSORSHIP_CRYPTO_SECRET_V1: Buffer.alloc(32, 31).toString("base64"),
  SPONSOR_PASSWORDLESS_RATE_LIMIT_SECRET_V1: Buffer.alloc(32, 47).toString(
    "base64",
  ),
}

function signals(email: string, headers: Record<string, string> = {}) {
  return rateLimit.createSponsorPasswordlessDeliverySignals({
    email,
    headers: new Headers(headers),
    environment,
  })
}

test("derives stable opaque recipient and trusted-source signals", () => {
  const first = signals(" Sponsor+Family@Example.com ", {
    "x-vercel-forwarded-for": "203.0.113.10",
  })
  const same = signals("sponsor+family@example.com", {
    "x-vercel-forwarded-for": "203.0.113.10",
  })
  const otherSource = signals("sponsor+family@example.com", {
    "x-vercel-forwarded-for": "203.0.113.11",
  })

  expect(first).toEqual(same)
  expect(first.recipientDigest).toMatch(/^\\x[0-9a-f]{64}$/)
  expect(first.sourceDigest).toMatch(/^\\x[0-9a-f]{64}$/)
  expect(first.sourceDigest).not.toBe(otherSource.sourceDigest)
  const verification = rateLimit.createSponsorPasswordlessVerificationSignals({
    headers: new Headers({
      "x-vercel-forwarded-for": "203.0.113.10",
    }),
    environment,
  })
  expect(verification.sourceDigest).toMatch(/^\\x[0-9a-f]{64}$/)
  expect(verification.sourceDigest).not.toBe(first.sourceDigest)
  expect(JSON.stringify(first)).not.toContain("sponsor")
  expect(JSON.stringify(first)).not.toContain("203.0.113")
})

test("ignores browser-spoofable forwarding headers and malformed Vercel sources", () => {
  const missing = signals("sponsor@example.com")
  const spoofed = signals("sponsor@example.com", {
    "cf-connecting-ip": "203.0.113.51",
    "x-forwarded-for": "203.0.113.52",
  })
  const multiple = signals("sponsor@example.com", {
    "x-vercel-forwarded-for": "203.0.113.53, 203.0.113.54",
  })
  const malformed = signals("sponsor@example.com", {
    "x-vercel-forwarded-for": "not-an-ip",
  })

  expect(spoofed.sourceDigest).toBe(missing.sourceDigest)
  expect(multiple.sourceDigest).toBe(missing.sourceDigest)
  expect(malformed.sourceDigest).toBe(missing.sourceDigest)

  const nonVercelSpoofed = rateLimit.createSponsorPasswordlessDeliverySignals({
    email: "sponsor@example.com",
    headers: new Headers({
      "x-vercel-forwarded-for": "203.0.113.53",
    }),
    environment: { ...environment, VERCEL: "0" },
  })
  const nonVercelMissing = rateLimit.createSponsorPasswordlessDeliverySignals({
    email: "sponsor@example.com",
    headers: new Headers(),
    environment: { ...environment, VERCEL: "0" },
  })
  expect(nonVercelSpoofed.sourceDigest).toBe(nonVercelMissing.sourceDigest)
})

test("accepts Vercel trace evidence only in a declared Vercel runtime", () => {
  const request = new Request("https://creatorshare.com/auth/confirm", {
    headers: { "x-vercel-id": "sfo1::trusted-trace" },
  })

  expect(
    rateLimit.sponsorPasswordlessDeliveryContext(request, environment).traceId,
  ).toBe("sfo1::trusted-trace")
  expect(
    rateLimit.sponsorPasswordlessDeliveryContext(request, {
      ...environment,
      VERCEL: "0",
    }).traceId,
  ).toBeNull()
})

test("fails closed for missing, short, or noncanonical source secrets", () => {
  for (const secret of [
    undefined,
    Buffer.alloc(16, 1).toString("base64"),
    Buffer.alloc(32, 1).toString("base64url"),
    `${Buffer.alloc(32, 1).toString("base64")}=`,
  ]) {
    expect(() =>
      rateLimit.createSponsorPasswordlessDeliverySignals({
        email: "sponsor@example.com",
        headers: new Headers(),
        environment: {
          ...environment,
          SPONSOR_PASSWORDLESS_RATE_LIMIT_SECRET_V1: secret,
        },
      }),
    ).toThrow("sponsor_passwordless_rate_limit_unavailable")
  }
})

test("accepts only the exact allowed reservation row", () => {
  expect(
    rateLimit.parseSponsorPasswordlessDeliveryReservation({
      delivery_allowed: true,
    }),
  ).toBe(true)
  expect(
    rateLimit.parseSponsorPasswordlessDeliveryReservation([
      { delivery_allowed: true },
    ]),
  ).toBe(true)

  for (const value of [
    null,
    [],
    [{ delivery_allowed: true }, { delivery_allowed: true }],
    { delivery_allowed: false },
    { delivery_allowed: true, recipient: "leak" },
    { deliveryAllowed: true },
  ]) {
    expect(rateLimit.parseSponsorPasswordlessDeliveryReservation(value)).toBe(
      false,
    )
  }

  expect(
    rateLimit.parseSponsorPasswordlessVerificationReservation({
      verification_allowed: true,
    }),
  ).toBe(true)
  expect(
    rateLimit.parseSponsorPasswordlessVerificationReservation([
      { verification_allowed: true },
    ]),
  ).toBe(true)
  for (const value of [
    null,
    [],
    [{ verification_allowed: true }, { verification_allowed: true }],
    { verification_allowed: false },
    { verification_allowed: true, token: "leak" },
    { verificationAllowed: true },
  ]) {
    expect(
      rateLimit.parseSponsorPasswordlessVerificationReservation(value),
    ).toBe(false)
  }
})

test("reserves one exact service-role RPC envelope", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = []
  const deliverySignals = signals("sponsor@example.com", {
    "x-vercel-forwarded-for": "2001:db8::1",
  })
  const allowed = await rateLimit.reserveSponsorPasswordlessDelivery({
    flow: "reauthentication",
    signals: deliverySignals,
    context: {
      requestId: "71000000-0000-4000-8000-000000000001",
      traceId: "sfo1::passwordless-test",
    },
    serviceClient: {
      async rpc(name: string, input: Record<string, unknown>) {
        calls.push({ name, input })
        return { data: [{ delivery_allowed: true }], error: null }
      },
    } as never,
  })

  expect(allowed).toBe(true)
  expect(calls).toEqual([
    {
      name: "reserve_sponsor_passwordless_email_delivery",
      input: {
        target_recipient_digest: deliverySignals.recipientDigest,
        target_recipient_normalization_version: 1,
        target_recipient_hmac_key_version: 1,
        target_source_digest: deliverySignals.sourceDigest,
        target_source_hmac_key_version: 1,
        delivery_flow: "reauthentication",
        context_request_id: "71000000-0000-4000-8000-000000000001",
        context_trace_id: "sfo1::passwordless-test",
      },
    },
  ])
})

test("exposes registration delivery and purpose-separated verification reservations", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = []
  const serviceClient = {
    async rpc(name: string, input: Record<string, unknown>) {
      calls.push({ name, input })
      return name === "reserve_sponsor_passwordless_email_delivery"
        ? { data: [{ delivery_allowed: true }], error: null }
        : { data: [{ verification_allowed: true }], error: null }
    },
  } as never
  const request = new Request("https://creatorshare.com/register", {
    headers: {
      "x-vercel-forwarded-for": "203.0.113.99",
      "x-vercel-id": "sfo1::registration-test",
    },
  })

  await expect(
    rateLimit.reserveSponsorPasswordlessDeliveryForRequest({
      flow: "registration",
      email: "new-sponsor@example.com",
      request,
      environment,
      serviceClient,
    }),
  ).resolves.toBe(true)

  const verificationSignals =
    rateLimit.createSponsorPasswordlessVerificationSignals({
      headers: request.headers,
      environment,
    })
  await expect(
    rateLimit.reserveSponsorPasswordlessVerificationAttempt({
      signals: verificationSignals,
      context: {
        requestId: "71000000-0000-4000-8000-000000000002",
        traceId: "sfo1::verification-test",
      },
      serviceClient,
    }),
  ).resolves.toBe(true)

  expect(calls).toHaveLength(2)
  expect(calls[0].name).toBe("reserve_sponsor_passwordless_email_delivery")
  expect(calls[0].input.delivery_flow).toBe("registration")
  expect(calls[1]).toEqual({
    name: "reserve_sponsor_passwordless_email_verification_attempt",
    input: {
      target_source_digest: verificationSignals.sourceDigest,
      target_source_hmac_key_version: 1,
      context_request_id: "71000000-0000-4000-8000-000000000002",
      context_trace_id: "sfo1::verification-test",
    },
  })
  expect(calls[0].input.target_source_digest).not.toBe(
    calls[1].input.target_source_digest,
  )
})
