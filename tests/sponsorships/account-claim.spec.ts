import { readFile } from "node:fs/promises"
import Module, { createRequire } from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import { parseSponsorClaimFragment } from "../../src/app/sponsor/claim/claimFragment"

type AccountClaimModule = typeof import("../../src/lib/sponsorships/accountClaim")
type CryptoModule = typeof import("../../src/lib/sponsorships/crypto")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

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
  resolve(process.cwd(), "tests/sponsorships/account-claim.spec.ts"),
)
const accountClaim = testRequire(
  "../../src/lib/sponsorships/accountClaim",
) as AccountClaimModule
const sponsorshipCryptoModule = testRequire(
  "../../src/lib/sponsorships/crypto",
) as CryptoModule
nodeModule._load = originalModuleLoad

const {
  buildSponsorClaimMagicLinkCallback,
  buildSponsorClaimPageRedirect,
  buildSponsorClaimWelcomeUrl,
  classifySponsorClaimDatabaseFailure,
  completeSponsorAccountClaim,
  decideSponsorClaimStart,
  getAllowedSponsorClaimCallbackTarget,
  getSponsorClaimCanonicalOrigin,
  getSponsorClaimCookieOptions,
  isTrustedSponsorClaimRequest,
  isValidSupabaseAuthCode,
  parseSponsorAccountClaimRpcResult,
  parseSponsorClaimStartBody,
  SponsorAccountClaimError,
  SPONSOR_ACCOUNT_CLAIM_CALLBACK_PATH,
  SPONSOR_ACCOUNT_CLAIM_COOKIE_MAX_AGE_SECONDS,
  SPONSOR_ACCOUNT_CLAIM_PAGE_PATH,
} = accountClaim
const { createSponsorshipCrypto } = sponsorshipCryptoModule

const APP_SECRET = Buffer.from(
  "creator-share-account-claim-test-secret-0000000000000000",
  "utf8",
).toString("base64")
const CLAIM_TOKEN = "A".repeat(43)
const CLAIM_EMAIL = " Sponsor+Family@Example.com "
const CANONICAL_ORIGIN = "https://creatorshare.com"
const crypto = createSponsorshipCrypto({ appSecretBase64: APP_SECRET })

function preparedClaim() {
  const prepared = parseSponsorClaimStartBody(
    JSON.stringify({ token: CLAIM_TOKEN, email: CLAIM_EMAIL }),
    crypto,
  )
  if (!prepared) throw new Error("Expected a prepared account claim")
  return prepared
}

test.describe("sponsor claim welcome and callback URLs", () => {
  test("keeps the raw claim token and email out of the HTTP request URL", () => {
    const welcomeUrl = buildSponsorClaimWelcomeUrl(
      CANONICAL_ORIGIN,
      CLAIM_TOKEN,
      CLAIM_EMAIL,
      crypto,
    )
    const parsed = new URL(welcomeUrl)
    const requestUrl = welcomeUrl.split("#", 1)[0]

    expect(parsed.origin).toBe(CANONICAL_ORIGIN)
    expect(parsed.pathname).toBe(SPONSOR_ACCOUNT_CLAIM_PAGE_PATH)
    expect(parsed.search).toBe("")
    expect(requestUrl).not.toContain(CLAIM_TOKEN)
    expect(requestUrl).not.toContain("Sponsor")
    expect(parseSponsorClaimFragment(parsed.hash)).toEqual({
      token: CLAIM_TOKEN,
      email: "sponsor+family@example.com",
    })
  })

  test("uses one fixed local callback and rejects hostile next targets", () => {
    const callback = new URL(
      buildSponsorClaimMagicLinkCallback(CANONICAL_ORIGIN),
    )

    expect(callback.origin).toBe(CANONICAL_ORIGIN)
    expect(callback.pathname).toBe(SPONSOR_ACCOUNT_CLAIM_CALLBACK_PATH)
    expect(callback.searchParams.get("next")).toBe(
      SPONSOR_ACCOUNT_CLAIM_PAGE_PATH,
    )
    expect(
      getAllowedSponsorClaimCallbackTarget("https://evil.example/collect"),
    ).toBe(SPONSOR_ACCOUNT_CLAIM_PAGE_PATH)
    expect(getAllowedSponsorClaimCallbackTarget("//evil.example/collect")).toBe(
      SPONSOR_ACCOUNT_CLAIM_PAGE_PATH,
    )
    expect(
      buildSponsorClaimPageRedirect(
        CANONICAL_ORIGIN,
        "https://evil.example/collect",
        "ready",
      ).toString(),
    ).toBe("https://creatorshare.com/sponsor/claim?state=ready")
  })

  test("accepts only bounded URL-safe Supabase authorization codes", () => {
    expect(isValidSupabaseAuthCode("abc_DEF-1234.xyz~789")).toBe(true)
    expect(isValidSupabaseAuthCode("short")).toBe(false)
    expect(isValidSupabaseAuthCode("a".repeat(2049))).toBe(false)
    expect(isValidSupabaseAuthCode("validLengthButHas/slash")).toBe(false)
    expect(isValidSupabaseAuthCode(["a".repeat(32)])).toBe(false)
  })
})

test.describe("sponsor claim canonical origin and cookie", () => {
  test("uses a configured HTTPS origin without request-host influence", () => {
    expect(
      getSponsorClaimCanonicalOrigin({
        NODE_ENV: "production",
        NEXT_PUBLIC_BASE_URL: "https://www.creatorshare.com/a/path?ignored=1",
      }),
    ).toBe("https://www.creatorshare.com")
    expect(
      getSponsorClaimCanonicalOrigin({ NODE_ENV: "production" }),
    ).toBe(CANONICAL_ORIGIN)
    expect(
      getSponsorClaimCanonicalOrigin({
        NODE_ENV: "development",
        NEXT_PUBLIC_BASE_URL: "http://localhost:3100",
      }),
    ).toBe("http://localhost:3100")
  })

  test("rejects insecure production and credential-bearing origins", () => {
    for (const value of [
      "http://creatorshare.com",
      "https://user:password@creatorshare.com",
      "not a url",
    ]) {
      expect(() =>
        getSponsorClaimCanonicalOrigin({
          NODE_ENV: "production",
          NEXT_PUBLIC_BASE_URL: value,
        }),
      ).toThrow(SponsorAccountClaimError)
    }
  })

  test("sets a short-lived host-only protected cookie", () => {
    const options = getSponsorClaimCookieOptions()

    expect(options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SPONSOR_ACCOUNT_CLAIM_COOKIE_MAX_AGE_SECONDS,
      priority: "high",
    })
    expect("domain" in options).toBe(false)
    expect(options.maxAge).toBe(30 * 60)
  })

  test("accepts only same-origin browser POSTs", () => {
    expect(
      isTrustedSponsorClaimRequest(
        new Headers({
          origin: CANONICAL_ORIGIN,
          "sec-fetch-site": "same-origin",
        }),
        CANONICAL_ORIGIN,
      ),
    ).toBe(true)
    expect(
      isTrustedSponsorClaimRequest(
        new Headers({ origin: "https://hope.creatorshare.com" }),
        CANONICAL_ORIGIN,
      ),
    ).toBe(false)
    expect(
      isTrustedSponsorClaimRequest(
        new Headers({
          origin: CANONICAL_ORIGIN,
          "sec-fetch-site": "cross-site",
        }),
        CANONICAL_ORIGIN,
      ),
    ).toBe(false)
  })
})

test.describe("sponsor claim start boundary", () => {
  test("validates and digests private values before database transport", () => {
    const prepared = preparedClaim()

    expect(prepared.claimToken).toBe(CLAIM_TOKEN)
    expect(prepared.email.normalizedEmail).toBe(
      "sponsor+family@example.com",
    )
    expect(prepared.claimTokenDigest).toMatch(/^\\x[0-9a-f]{64}$/)
    expect(prepared.email.digestRpcBytea).toMatch(/^\\x[0-9a-f]{64}$/)
    expect(prepared.claimTokenDigest).not.toContain(CLAIM_TOKEN)
    expect(prepared.email.digestRpcBytea).not.toContain("sponsor")

    for (const body of [
      "not json",
      JSON.stringify({ token: "short", email: CLAIM_EMAIL }),
      JSON.stringify({ token: CLAIM_TOKEN, email: "not-an-email" }),
      JSON.stringify({ token: CLAIM_TOKEN }),
      "x".repeat(4097),
    ]) {
      expect(parseSponsorClaimStartBody(body, crypto)).toBeNull()
    }
  })

  test("does not send email for an unknown or expired claim", async () => {
    let authenticatedLookupCount = 0
    let sendCount = 0
    const disposition = await decideSponsorClaimStart(
      preparedClaim(),
      CANONICAL_ORIGIN,
      crypto,
      {
        async isPendingClaim() {
          return false
        },
        async getAuthenticatedUser() {
          authenticatedLookupCount += 1
          return null
        },
        async sendMagicLink() {
          sendCount += 1
        },
      },
    )

    expect(disposition).toBe("check-email")
    expect(authenticatedLookupCount).toBe(0)
    expect(sendCount).toBe(0)
  })

  test("allows a matching confirmed user to complete without another email", async () => {
    let sendCount = 0
    const disposition = await decideSponsorClaimStart(
      preparedClaim(),
      CANONICAL_ORIGIN,
      crypto,
      {
        async isPendingClaim() {
          return true
        },
        async getAuthenticatedUser() {
          return {
            id: "90000000-0000-4000-8000-000000000001",
            email: "sponsor+family@example.com",
            emailConfirmedAt: "2026-07-18T08:00:00.000Z",
          }
        },
        async sendMagicLink() {
          sendCount += 1
        },
      },
    )

    expect(disposition).toBe("ready")
    expect(sendCount).toBe(0)
  })

  test("sends a fixed passwordless callback for a signed-out user", async () => {
    const sent: Array<{ email: string; emailRedirectTo: string }> = []
    const disposition = await decideSponsorClaimStart(
      preparedClaim(),
      CANONICAL_ORIGIN,
      crypto,
      {
        async isPendingClaim() {
          return true
        },
        async getAuthenticatedUser() {
          return null
        },
        async sendMagicLink(input) {
          sent.push(input)
        },
      },
    )

    expect(disposition).toBe("check-email")
    expect(sent).toEqual([
      {
        email: "sponsor+family@example.com",
        emailRedirectTo:
          "https://creatorshare.com/auth/callback?next=%2Fsponsor%2Fclaim",
      },
    ])
  })

  test("keeps the public disposition generic when email delivery fails", async () => {
    const disposition = await decideSponsorClaimStart(
      preparedClaim(),
      CANONICAL_ORIGIN,
      crypto,
      {
        async isPendingClaim() {
          return true
        },
        async getAuthenticatedUser() {
          return null
        },
        async sendMagicLink() {
          throw new Error("mail provider unavailable")
        },
      },
    )

    expect(disposition).toBe("check-email")
  })
})

test.describe("authenticated sponsor claim completion", () => {
  test("normalizes bounded PostgreSQL integer transport values", () => {
    expect(
      parseSponsorAccountClaimRpcResult([
        { linked_subscription_count: "3" },
      ]),
    ).toEqual({ linkedSubscriptionCount: 3 })
    expect(
      parseSponsorAccountClaimRpcResult({ linked_subscription_count: 0 }),
    ).toEqual({ linkedSubscriptionCount: 0 })

    for (const value of [
      [],
      [{ linked_subscription_count: -1 }],
      [{ linked_subscription_count: "3.5" }],
      [{ linked_subscription_count: Number.MAX_SAFE_INTEGER + 1 }],
      [{ linked_subscription_count: null }],
    ]) {
      expect(() => parseSponsorAccountClaimRpcResult(value)).toThrow(
        SponsorAccountClaimError,
      )
    }
  })

  test("derives identity only from confirmed auth and returns only the linked count", async () => {
    const order: string[] = []
    const issued: unknown[] = []
    const consumed: unknown[] = []
    const result = await completeSponsorAccountClaim(
      CLAIM_TOKEN,
      {
        requestId: "request-1",
        traceId: "trace-1",
        clientIp: "203.0.113.8",
        userAgent: "Test Browser",
      },
      {
        crypto,
        async getAuthenticatedUser() {
          order.push("auth")
          return {
            id: "90000000-0000-4000-8000-000000000001",
            email: "Sponsor+Family@Example.com",
            emailConfirmedAt: "2026-07-18T08:00:00.000Z",
          }
        },
        async issueEmailVerification(input) {
          order.push("proof")
          issued.push(input)
        },
        async consumeClaim(input) {
          order.push("consume")
          consumed.push(input)
          return { linkedSubscriptionCount: 3 }
        },
      },
    )

    expect(order).toEqual(["auth", "proof", "consume"])
    expect(result).toEqual({ linkedSubscriptionCount: 3 })
    expect(Object.keys(result)).toEqual(["linkedSubscriptionCount"])
    expect(issued).toHaveLength(1)
    expect(issued[0]).toMatchObject({
      authUserId: "90000000-0000-4000-8000-000000000001",
      emailNormalizationVersion: 1,
      emailHmacKeyVersion: 1,
      validFor: "10 minutes",
      requestId: "request-1",
      traceId: "trace-1",
    })
    expect(issued[0]).toHaveProperty(
      "emailDigest",
      crypto.digestEmail(CLAIM_EMAIL).digestRpcBytea,
    )
    expect(consumed).toEqual([
      {
        claimTokenDigest: preparedClaim().claimTokenDigest,
        requestId: "request-1",
        traceId: "trace-1",
        clientIp: "203.0.113.8",
        userAgent: "Test Browser",
      },
    ])
  })

  test("rejects missing confirmation before issuing any service proof", async () => {
    let proofCount = 0
    await expect(
      completeSponsorAccountClaim(
        CLAIM_TOKEN,
        {
          requestId: "request-2",
          traceId: null,
          clientIp: null,
          userAgent: null,
        },
        {
          crypto,
          async getAuthenticatedUser() {
            return {
              id: "90000000-0000-4000-8000-000000000001",
              email: CLAIM_EMAIL,
              emailConfirmedAt: null,
            }
          },
          async issueEmailVerification() {
            proofCount += 1
          },
          async consumeClaim() {
            return { linkedSubscriptionCount: 0 }
          },
        },
      ),
    ).rejects.toMatchObject({ code: "unauthenticated", httpStatus: 401 })
    expect(proofCount).toBe(0)
  })

  test("rejects malformed cookie tokens before authentication", async () => {
    let authCount = 0
    await expect(
      completeSponsorAccountClaim(
        "malformed",
        {
          requestId: "request-3",
          traceId: null,
          clientIp: null,
          userAgent: null,
        },
        {
          crypto,
          async getAuthenticatedUser() {
            authCount += 1
            return null
          },
          async issueEmailVerification() {},
          async consumeClaim() {
            return { linkedSubscriptionCount: 0 }
          },
        },
      ),
    ).rejects.toMatchObject({ code: "invalid-or-expired", httpStatus: 410 })
    expect(authCount).toBe(0)
  })

  test("maps database failures to safe user-facing states", () => {
    expect(
      classifySponsorClaimDatabaseFailure({
        code: "23514",
        message: "Verified account email does not match the account claim",
      }).code,
    ).toBe("email-mismatch")
    expect(
      classifySponsorClaimDatabaseFailure({
        code: "23514",
        message: "Account claim is no longer available",
      }).code,
    ).toBe("invalid-or-expired")
    expect(
      classifySponsorClaimDatabaseFailure({
        code: "23505",
        message: "Account already owns another sponsor identity",
      }).code,
    ).toBe("account-conflict")
    expect(
      classifySponsorClaimDatabaseFailure({
        code: "XX000",
        message: "internal failure",
      }).code,
    ).toBe("unavailable")
  })
})

test.describe("claim fragment parser", () => {
  test("rejects duplicate, missing, and oversized private values", () => {
    expect(
      parseSponsorClaimFragment(`#token=${CLAIM_TOKEN}&email=a%40example.com`),
    ).toEqual({ token: CLAIM_TOKEN, email: "a@example.com" })
    expect(
      parseSponsorClaimFragment(
        `#token=${CLAIM_TOKEN}&token=${CLAIM_TOKEN}&email=a%40example.com`,
      ),
    ).toBeNull()
    expect(parseSponsorClaimFragment(`#token=${CLAIM_TOKEN}`)).toBeNull()
    expect(parseSponsorClaimFragment("#" + "x".repeat(2048))).toBeNull()
  })

  test("completion ignores request bodies and claim routes do not log secrets", async () => {
    const [startSource, completeSource, callbackSource] = await Promise.all([
      readFile(
        resolve(process.cwd(), "src/app/api/sponsor-account/start/route.ts"),
        "utf8",
      ),
      readFile(
        resolve(
          process.cwd(),
          "src/app/api/sponsor-account/complete/route.ts",
        ),
        "utf8",
      ),
      readFile(
        resolve(process.cwd(), "src/app/auth/callback/route.ts"),
        "utf8",
      ),
    ])

    expect(completeSource).not.toContain("request.json")
    expect(completeSource).not.toContain("request.text")
    for (const source of [startSource, completeSource, callbackSource]) {
      expect(source).not.toMatch(/console\.(?:log|error|warn)/)
    }
  })
})
