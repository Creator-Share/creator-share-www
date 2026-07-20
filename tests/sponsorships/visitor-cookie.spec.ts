import { createRequire } from "node:module"
import { createHmac, hkdfSync } from "node:crypto"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type VisitorCookieModule =
  typeof import("../../src/lib/sponsorships/visitorCookie")
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
  resolve(process.cwd(), "tests/sponsorships/visitor-cookie.spec.ts"),
)
const visitorCookie = testRequire(
  "../../src/lib/sponsorships/visitorCookie",
) as VisitorCookieModule
nodeModule._load = originalModuleLoad

const {
  createSponsorshipVisitorToken: createScopedSponsorshipVisitorToken,
  getSponsorshipVisitorCookieOptions,
  isStructurallyValidSponsorshipVisitorToken,
  readSponsorshipVisitorCookie: readScopedSponsorshipVisitorCookie,
  resolveSponsorshipVisitorCookie: resolveScopedSponsorshipVisitorCookie,
  SPONSORSHIP_VISITOR_COOKIE_MAX_AGE_SECONDS,
  SPONSORSHIP_VISITOR_COOKIE_NAME,
  verifySponsorshipVisitorToken: verifyScopedSponsorshipVisitorToken,
} = visitorCookie

const TEST_ENVIRONMENT = Object.freeze({ NODE_ENV: "test" })
const TEST_REQUEST_CONTEXT = Object.freeze({ rawHost: "creatorshare.com" })

function createSponsorshipVisitorToken(
  environment: Readonly<Record<string, string | undefined>> = TEST_ENVIRONMENT,
) {
  return createScopedSponsorshipVisitorToken(TEST_REQUEST_CONTEXT, environment)
}

function verifySponsorshipVisitorToken(
  value: string | null | undefined,
  environment: Readonly<Record<string, string | undefined>> = TEST_ENVIRONMENT,
) {
  return verifyScopedSponsorshipVisitorToken(
    value,
    TEST_REQUEST_CONTEXT,
    environment,
  )
}

function readSponsorshipVisitorCookie(
  cookieHeader: string | null,
  environment: Readonly<Record<string, string | undefined>> = TEST_ENVIRONMENT,
) {
  return readScopedSponsorshipVisitorCookie(
    cookieHeader,
    TEST_REQUEST_CONTEXT,
    environment,
  )
}

function resolveSponsorshipVisitorCookie(
  cookieHeader: string | null,
  environment: Readonly<Record<string, string | undefined>> = TEST_ENVIRONMENT,
) {
  return resolveScopedSponsorshipVisitorCookie(
    cookieHeader,
    TEST_REQUEST_CONTEXT,
    environment,
  )
}

test("creates independent authenticated 256 bit visitor identifiers", async () => {
  const first = await createSponsorshipVisitorToken(TEST_ENVIRONMENT)
  const second = await createSponsorshipVisitorToken(TEST_ENVIRONMENT)

  expect(first).toMatch(/^v2\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{22}$/)
  expect(second).toMatch(/^v2\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{22}$/)
  expect(second).not.toBe(first)
  expect(await verifySponsorshipVisitorToken(first, TEST_ENVIRONMENT)).toBe(
    true,
  )
})

test("accepts only the exact version two token encoding", async () => {
  const token = await createSponsorshipVisitorToken(TEST_ENVIRONMENT)

  expect(isStructurallyValidSponsorshipVisitorToken(token)).toBe(true)
  expect(isStructurallyValidSponsorshipVisitorToken(`${token}a`)).toBe(false)
  expect(isStructurallyValidSponsorshipVisitorToken(token?.slice(1))).toBe(
    false,
  )
  expect(isStructurallyValidSponsorshipVisitorToken("a".repeat(43))).toBe(false)
  expect(
    isStructurallyValidSponsorshipVisitorToken(
      `v1.${"a".repeat(43)}.${"a".repeat(22)}`,
    ),
  ).toBe(false)
  expect(
    isStructurallyValidSponsorshipVisitorToken(
      `v2.${"a".repeat(43)}.${"a".repeat(22)}`,
    ),
  ).toBe(true)
  expect(isStructurallyValidSponsorshipVisitorToken(null)).toBe(false)
})

test("rejects forged tags, missing production keys, and duplicate cookies", async () => {
  const secret = Buffer.alloc(32, 11).toString("base64")
  const otherSecret = Buffer.alloc(32, 12).toString("base64")
  const environment = {
    NODE_ENV: "production",
    SPONSORSHIP_VISITOR_COOKIE_SECRET_V1: secret,
  }
  const token = await createSponsorshipVisitorToken(environment)
  const secondToken = await createSponsorshipVisitorToken(environment)
  expect(token).not.toBeNull()
  expect(secondToken).not.toBeNull()
  expect(await verifySponsorshipVisitorToken(token, environment)).toBe(true)
  expect(
    await verifySponsorshipVisitorToken(token, {
      ...environment,
      SPONSORSHIP_VISITOR_COOKIE_SECRET_V1: otherSecret,
    }),
  ).toBe(false)
  expect(
    await createSponsorshipVisitorToken({ NODE_ENV: "production" }),
  ).toBeNull()
  expect(
    await createSponsorshipVisitorToken({
      NODE_ENV: "test",
      SPONSORSHIP_VISITOR_COOKIE_SECRET_V1: "present-but-invalid",
    }),
  ).toBeNull()
  expect(
    await createSponsorshipVisitorToken({
      ...environment,
      SPONSORSHIP_CRYPTO_SECRET_V1: secret,
    }),
  ).toBeNull()

  const cookie = `${SPONSORSHIP_VISITOR_COOKIE_NAME}=${token}`
  expect(await readSponsorshipVisitorCookie(cookie, environment)).toBe(token)
  expect(
    await readSponsorshipVisitorCookie(`${cookie}; ${cookie}`, environment),
  ).toBe(token)
  expect(
    await readSponsorshipVisitorCookie(
      `${cookie}; ${SPONSORSHIP_VISITOR_COOKIE_NAME}=forged`,
      environment,
    ),
  ).toBe(token)

  expect(
    await resolveSponsorshipVisitorCookie(`${cookie}; ${cookie}`, environment),
  ).toEqual({
    token,
    hadCandidates: true,
    requiresNormalization: true,
  })
  expect(
    await resolveSponsorshipVisitorCookie(
      `${cookie}; ${SPONSORSHIP_VISITOR_COOKIE_NAME}=${secondToken}`,
      environment,
    ),
  ).toEqual({
    token: null,
    hadCandidates: true,
    requiresNormalization: true,
  })
})

test("verifies scoped tokens produced by the documented Node cryptography algorithm", async () => {
  const secret = Buffer.alloc(32, 21)
  const visitorId = Buffer.alloc(32, 7).toString("base64url")
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      secret,
      Buffer.from("creator-share/sponsorship/key-derivation/v1"),
      Buffer.from(
        "creator-share/sponsorship/visitor-cookie-hmac-key/v2\0host:creatorshare.com",
      ),
      32,
    ),
  )
  const tag = createHmac("sha256", key)
    .update(Buffer.from("creator-share/sponsorship/visitor-cookie/v2\0"))
    .update(visitorId, "utf8")
    .digest()
    .subarray(0, 16)
    .toString("base64url")
  const token = `v2.${visitorId}.${tag}`

  await expect(
    verifySponsorshipVisitorToken(token, {
      NODE_ENV: "production",
      SPONSORSHIP_VISITOR_COOKIE_SECRET_V1: secret.toString("base64"),
    }),
  ).resolves.toBe(true)
})

test("normalizes equivalent hosts and rejects a host-scoped token on a sibling", async () => {
  const environment = {
    NODE_ENV: "production",
    SPONSORSHIP_VISITOR_COOKIE_SECRET_V1: Buffer.alloc(32, 22).toString(
      "base64",
    ),
  }
  const token = await createScopedSponsorshipVisitorToken(
    { rawHost: "Hope.CreatorShare.com.:443" },
    environment,
  )
  expect(token).not.toBeNull()
  await expect(
    verifyScopedSponsorshipVisitorToken(
      token,
      { rawHost: "hope.creatorshare.com" },
      environment,
    ),
  ).resolves.toBe(true)
  await expect(
    verifyScopedSponsorshipVisitorToken(
      token,
      { rawHost: "another.creatorshare.com" },
      environment,
    ),
  ).resolves.toBe(false)
})

test("keeps the Creator Share domain family host only until review approval", () => {
  const root = getSponsorshipVisitorCookieOptions("creatorshare.com", true, {
    NODE_ENV: "production",
  })
  const advocate = getSponsorshipVisitorCookieOptions(
    "hope.creatorshare.com",
    true,
    { NODE_ENV: "production" },
  )
  const reserved = getSponsorshipVisitorCookieOptions(
    "www.creatorshare.com",
    true,
    { NODE_ENV: "production" },
  )

  for (const options of [root, advocate, reserved]) {
    expect(options.domain).toBeUndefined()
    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe("lax")
    expect(options.secure).toBe(true)
    expect(options.maxAge).toBe(SPONSORSHIP_VISITOR_COOKIE_MAX_AGE_SECONDS)
  }
})

test("keeps preview and local cookies host only", () => {
  const preview = getSponsorshipVisitorCookieOptions(
    "creator-share-preview.vercel.app",
    true,
  )
  const local = getSponsorshipVisitorCookieOptions("hope.localhost:3000", false)

  expect(preview.domain).toBeUndefined()
  expect(preview.secure).toBe(true)
  expect(local.domain).toBeUndefined()
  expect(local.secure).toBe(false)
})

test("fails closed to a host only cookie for malformed host input", () => {
  const options = getSponsorshipVisitorCookieOptions(
    "hope.creatorshare.com.evil.example",
    true,
  )

  expect(options.domain).toBeUndefined()
  expect(options.secure).toBe(true)
})
