import { createHmac } from "node:crypto"
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
  typeof import("../../src/lib/advocates/invitations/rateLimit")

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
  resolve(
    process.cwd(),
    "tests/advocates/invitation-authentication-rate-limit.spec.ts",
  ),
)
const rateLimit = testRequire(
  "../../src/lib/advocates/invitations/rateLimit",
) as RateLimitModule
nodeModule._load = originalModuleLoad

const sourceSecret = Buffer.alloc(32, 73)
const environment = {
  VERCEL: "1",
  ADVOCATE_INVITATION_AUTHENTICATION_RATE_LIMIT_SECRET_V1:
    sourceSecret.toString("base64"),
}
const UNAVAILABLE_ERROR =
  /^advocate_invitation_authentication_rate_limit_unavailable$/

function signals(headers: Record<string, string> = {}) {
  return rateLimit.createAdvocateInvitationAuthenticationRateLimitSignals({
    headers: new Headers(headers),
    environment,
  })
}

test("derives a stable opaque digest in the invitation authentication domain", () => {
  const first = signals({ "x-vercel-forwarded-for": "203.0.113.41" })
  const same = signals({ "x-vercel-forwarded-for": "203.0.113.41" })
  const other = signals({ "x-vercel-forwarded-for": "203.0.113.42" })
  const expected = createHmac("sha256", sourceSecret)
    .update(
      Buffer.from(
        "creator-share/advocate-invitation/authentication-attempt-source/v1\0",
        "utf8",
      ),
    )
    .update("203.0.113.41", "utf8")
    .digest("hex")
  const neighboringPurpose = createHmac("sha256", sourceSecret)
    .update(
      Buffer.from(
        "creator-share/sponsor-passwordless/verification-source/v1\0",
        "utf8",
      ),
    )
    .update("203.0.113.41", "utf8")
    .digest("hex")

  expect(first).toEqual(same)
  expect(first).toEqual({
    sourceDigest: `\\x${expected}`,
    sourceHmacKeyVersion: 1,
  })
  expect(first.sourceDigest).not.toBe(other.sourceDigest)
  expect(first.sourceDigest).not.toBe(`\\x${neighboringPurpose}`)
  expect(JSON.stringify(first)).not.toContain("203.0.113")
})

test("canonicalizes equivalent IPv6 source representations", () => {
  const expanded = signals({
    "x-vercel-forwarded-for": "2001:0DB8:0:0:0:0:0:1",
  })
  const compressed = signals({
    "x-vercel-forwarded-for": "2001:db8::1",
  })

  expect(expanded.sourceDigest).toBe(compressed.sourceDigest)
})

test("trusts only a single valid Vercel source in a declared Vercel runtime", () => {
  const unavailable = signals()
  const spoofed = signals({
    "cf-connecting-ip": "203.0.113.50",
    "x-forwarded-for": "203.0.113.51",
  })
  const multiple = signals({
    "x-vercel-forwarded-for": "203.0.113.52, 203.0.113.53",
  })
  const malformed = signals({
    "x-vercel-forwarded-for": "not-an-ip",
  })
  const nonVercel =
    rateLimit.createAdvocateInvitationAuthenticationRateLimitSignals({
      headers: new Headers({
        "x-vercel-forwarded-for": "203.0.113.54",
      }),
      environment: { ...environment, VERCEL: "0" },
    })
  const nonVercelWithoutHeader =
    rateLimit.createAdvocateInvitationAuthenticationRateLimitSignals({
      headers: new Headers(),
      environment: { ...environment, VERCEL: "0" },
    })

  expect(spoofed.sourceDigest).toBe(unavailable.sourceDigest)
  expect(multiple.sourceDigest).toBe(unavailable.sourceDigest)
  expect(malformed.sourceDigest).toBe(unavailable.sourceDigest)
  expect(nonVercel.sourceDigest).toBe(nonVercelWithoutHeader.sourceDigest)
})

test("rejects missing, weak, oversized, and noncanonical dedicated secrets", () => {
  for (const secret of [
    undefined,
    Buffer.alloc(16, 1).toString("base64"),
    Buffer.alloc(32, 255).toString("base64url"),
    `${Buffer.alloc(32, 1).toString("base64")}=`,
    Buffer.alloc(1025, 1).toString("base64"),
  ]) {
    expect(() =>
      rateLimit.createAdvocateInvitationAuthenticationRateLimitSignals({
        headers: new Headers(),
        environment: {
          VERCEL: "1",
          ADVOCATE_INVITATION_AUTHENTICATION_RATE_LIMIT_SECRET_V1: secret,
        },
      }),
    ).toThrow(UNAVAILABLE_ERROR)
  }

  expect(() =>
    rateLimit.createAdvocateInvitationAuthenticationRateLimitSignals({
      headers: new Headers(),
      environment: {
        VERCEL: "1",
        SPONSOR_PASSWORDLESS_RATE_LIMIT_SECRET_V1:
          sourceSecret.toString("base64"),
      },
    }),
  ).toThrow(UNAVAILABLE_ERROR)
})

test("accepts only the exact singleton allowed response", () => {
  expect(
    rateLimit.parseAdvocateInvitationAuthenticationReservation({
      authentication_allowed: true,
    }),
  ).toBe(true)
  expect(
    rateLimit.parseAdvocateInvitationAuthenticationReservation([
      { authentication_allowed: true },
    ]),
  ).toBe(true)
  expect(
    rateLimit.parseAdvocateInvitationAuthenticationReservation({
      authentication_allowed: false,
    }),
  ).toBe(false)
  expect(
    rateLimit.parseAdvocateInvitationAuthenticationReservation([
      { authentication_allowed: false },
    ]),
  ).toBe(false)

  for (const value of [
    null,
    [],
    [{ authentication_allowed: true }, { authentication_allowed: true }],
    { authentication_allowed: true, reason: "quota" },
    { authenticationAllowed: true },
    true,
  ]) {
    expect(() =>
      rateLimit.parseAdvocateInvitationAuthenticationReservation(value),
    ).toThrow(UNAVAILABLE_ERROR)
  }
})

test("sends only the opaque source signal to the service role RPC", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = []
  const request = new Request("https://advocate.creatorshare.com/invitation", {
    headers: { "x-vercel-forwarded-for": "203.0.113.61" },
  })
  const expectedSignals = signals({
    "x-vercel-forwarded-for": "203.0.113.61",
  })
  const allowed =
    await rateLimit.reserveAdvocateInvitationAuthenticationAttempt({
      request,
      environment,
      serviceClient: {
        async rpc(name: string, input: Record<string, unknown>) {
          calls.push({ name, input })
          return {
            data: [{ authentication_allowed: true }],
            error: null,
          }
        },
      } as never,
    })

  expect(allowed).toBe(true)
  expect(calls).toEqual([
    {
      name: "reserve_advocate_invitation_authentication_attempt",
      input: {
        target_source_digest: expectedSignals.sourceDigest,
        target_source_hmac_key_version: 1,
      },
    },
  ])
  expect(JSON.stringify(calls)).not.toContain("203.0.113")
  expect(Object.keys(calls[0].input)).toEqual([
    "target_source_digest",
    "target_source_hmac_key_version",
  ])
})

test("distinguishes exact quota denial from sanitized infrastructure failure", async () => {
  const request = new Request("https://advocate.creatorshare.com/invitation")

  await expect(
    rateLimit.reserveAdvocateInvitationAuthenticationAttempt({
      request,
      environment: { VERCEL: "1" },
      serviceClient: {
        async rpc() {
          throw new Error("must not be reached")
        },
      } as never,
    }),
  ).rejects.toThrow(UNAVAILABLE_ERROR)

  await expect(
    rateLimit.reserveAdvocateInvitationAuthenticationAttempt({
      request,
      environment,
      serviceClient: {
        async rpc() {
          return {
            data: null,
            error: { message: "private provider detail" },
          }
        },
      } as never,
    }),
  ).rejects.toThrow(UNAVAILABLE_ERROR)

  await expect(
    rateLimit.reserveAdvocateInvitationAuthenticationAttempt({
      request,
      environment,
      serviceClient: {
        async rpc() {
          throw new Error("private transport detail")
        },
      } as never,
    }),
  ).rejects.toThrow(UNAVAILABLE_ERROR)

  await expect(
    rateLimit.reserveAdvocateInvitationAuthenticationAttempt({
      request,
      environment,
      serviceClient: {
        async rpc() {
          return {
            data: [{ authentication_allowed: true, leaked: "detail" }],
            error: null,
          }
        },
      } as never,
    }),
  ).rejects.toThrow(UNAVAILABLE_ERROR)

  await expect(
    rateLimit.reserveAdvocateInvitationAuthenticationAttempt({
      request,
      environment,
      serviceClient: {
        async rpc() {
          return {
            data: [{ authentication_allowed: false }],
            error: null,
          }
        },
      } as never,
    }),
  ).resolves.toBe(false)
})
