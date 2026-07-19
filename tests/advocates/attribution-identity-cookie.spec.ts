import { createHmac, hkdfSync } from "node:crypto"

import { expect, test } from "@playwright/test"

import {
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_MAX_AGE_SECONDS,
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
  createAdvocateAttributionIdentityCookieValue,
  getAdvocateAttributionIdentityCookieOptions,
  readAdvocateAttributionIdentityCookie,
  resolveAdvocateAttributionIdentityCookie,
  verifyAdvocateAttributionIdentityCookieValue,
} from "../../src/lib/advocates/attributionIdentityCookie"

const AUTH_USER_ID = "97abcdef-abcd-4abc-8abc-abcdef000001"
const OTHER_AUTH_USER_ID = "97abcdef-abcd-4abc-8abc-abcdef000002"
const ISSUED_AT_SECONDS = 1_800_000_000
const EXPIRES_AT_SECONDS =
  ISSUED_AT_SECONDS + ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_MAX_AGE_SECONDS
const CURRENT_SECRET = Buffer.alloc(32, 41).toString("base64")
const PREVIOUS_SECRET = Buffer.alloc(32, 42).toString("base64")
const OTHER_SECRET = Buffer.alloc(32, 43).toString("base64")
const PRODUCTION_ENVIRONMENT = Object.freeze({
  NODE_ENV: "production",
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1: CURRENT_SECRET,
})

function createCookieValue(
  overrides: Partial<{
    authUserId: string
    issuedAtSeconds: number
    expiresAtSeconds: number
  }> = {},
  environment: Readonly<
    Record<string, string | undefined>
  > = PRODUCTION_ENVIRONMENT,
): string {
  const value = createAdvocateAttributionIdentityCookieValue(
    {
      authUserId: overrides.authUserId ?? AUTH_USER_ID,
      issuedAtSeconds: overrides.issuedAtSeconds ?? ISSUED_AT_SECONDS,
      expiresAtSeconds: overrides.expiresAtSeconds ?? EXPIRES_AT_SECONDS,
    },
    environment,
  )
  if (value === null) throw new Error("Test cookie signing failed")
  return value
}

test("signs only a versioned auth UUID and bounded timestamps", () => {
  const value = createAdvocateAttributionIdentityCookieValue(
    {
      authUserId: AUTH_USER_ID,
      issuedAtSeconds: ISSUED_AT_SECONDS,
      expiresAtSeconds: EXPIRES_AT_SECONDS,
      email: "private@example.com",
      role: "administrator",
    } as Parameters<typeof createAdvocateAttributionIdentityCookieValue>[0] & {
      email: string
      role: string
    },
    PRODUCTION_ENVIRONMENT,
  )

  expect(value).toMatch(
    /^v1\.[0-9a-f-]{36}\.[1-9][0-9]+\.[1-9][0-9]+\.[A-Za-z0-9_-]{43}$/,
  )
  expect(value).not.toContain("private@example.com")
  expect(value).not.toContain("administrator")

  const verification = verifyAdvocateAttributionIdentityCookieValue(
    value,
    PRODUCTION_ENVIRONMENT,
    ISSUED_AT_SECONDS,
  )
  expect(verification?.signal).toEqual({
    authUserId: AUTH_USER_ID,
    issuedAtSeconds: ISSUED_AT_SECONDS,
    expiresAtSeconds: EXPIRES_AT_SECONDS,
  })
  expect(Object.keys(verification?.signal ?? {})).toEqual([
    "authUserId",
    "issuedAtSeconds",
    "expiresAtSeconds",
  ])
  expect(Object.isFrozen(verification?.signal)).toBe(true)
  expect(verification?.requiresRefresh).toBe(false)
})

test("matches the documented HKDF and HMAC signing contract", () => {
  const payload = `v1.${AUTH_USER_ID}.${ISSUED_AT_SECONDS}.${EXPIRES_AT_SECONDS}`
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(CURRENT_SECRET, "base64"),
      Buffer.from("creator-share/advocates/key-derivation/v1"),
      Buffer.from(
        "creator-share/advocates/attribution-identity-cookie-hmac-key/v1",
      ),
      32,
    ),
  )
  const tag = createHmac("sha256", key)
    .update(
      Buffer.from("creator-share/advocates/attribution-identity-cookie/v1\0"),
    )
    .update(payload, "utf8")
    .digest("base64url")

  expect(createCookieValue()).toBe(`${payload}.${tag}`)
})

test("rejects invalid identities, timestamps, and lifetimes", () => {
  for (const authUserId of [
    "",
    AUTH_USER_ID.toUpperCase(),
    "00000000-0000-0000-0000-000000000000",
    "not-a-uuid",
  ]) {
    expect(
      createAdvocateAttributionIdentityCookieValue(
        {
          authUserId,
          issuedAtSeconds: ISSUED_AT_SECONDS,
          expiresAtSeconds: EXPIRES_AT_SECONDS,
        },
        PRODUCTION_ENVIRONMENT,
      ),
    ).toBeNull()
  }

  for (const [issuedAtSeconds, expiresAtSeconds] of [
    [0, EXPIRES_AT_SECONDS],
    [1.5, EXPIRES_AT_SECONDS],
    [ISSUED_AT_SECONDS, ISSUED_AT_SECONDS],
    [ISSUED_AT_SECONDS, ISSUED_AT_SECONDS - 1],
    [ISSUED_AT_SECONDS, EXPIRES_AT_SECONDS + 1],
    [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 2],
  ]) {
    expect(
      createAdvocateAttributionIdentityCookieValue(
        { authUserId: AUTH_USER_ID, issuedAtSeconds, expiresAtSeconds },
        PRODUCTION_ENVIRONMENT,
      ),
    ).toBeNull()
  }
})

test("enforces issuance, exact expiry, and the 400 day ceiling", () => {
  const value = createCookieValue()

  expect(
    verifyAdvocateAttributionIdentityCookieValue(
      value,
      PRODUCTION_ENVIRONMENT,
      ISSUED_AT_SECONDS - 1,
    ),
  ).toBeNull()
  expect(
    verifyAdvocateAttributionIdentityCookieValue(
      value,
      PRODUCTION_ENVIRONMENT,
      ISSUED_AT_SECONDS,
    ),
  ).not.toBeNull()
  expect(
    verifyAdvocateAttributionIdentityCookieValue(
      value,
      PRODUCTION_ENVIRONMENT,
      EXPIRES_AT_SECONDS - 1,
    ),
  ).not.toBeNull()
  expect(
    verifyAdvocateAttributionIdentityCookieValue(
      value,
      PRODUCTION_ENVIRONMENT,
      EXPIRES_AT_SECONDS,
    ),
  ).toBeNull()

  const excessiveLifetime = value.replace(
    `.${EXPIRES_AT_SECONDS}.`,
    `.${EXPIRES_AT_SECONDS + 1}.`,
  )
  expect(
    verifyAdvocateAttributionIdentityCookieValue(
      excessiveLifetime,
      PRODUCTION_ENVIRONMENT,
      ISSUED_AT_SECONDS,
    ),
  ).toBeNull()
})

test("rejects every tampered or noncanonical token component", () => {
  const value = createCookieValue()
  const parts = value.split(".")
  const tag = parts[4]
  const alteredTag = `${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}`

  for (const tampered of [
    value.replace(/^v1\./, "v2."),
    value.replace(AUTH_USER_ID, OTHER_AUTH_USER_ID),
    value.replace(`.${ISSUED_AT_SECONDS}.`, `.${ISSUED_AT_SECONDS + 1}.`),
    value.replace(`.${EXPIRES_AT_SECONDS}.`, `.${EXPIRES_AT_SECONDS - 1}.`),
    `${parts.slice(0, 4).join(".")}.${alteredTag}`,
    `${value}=`,
    value.toUpperCase(),
    value.replace(`.${ISSUED_AT_SECONDS}.`, `.0${ISSUED_AT_SECONDS}.`),
    value.slice(0, -1),
    `${value}x`,
  ]) {
    expect(
      verifyAdvocateAttributionIdentityCookieValue(
        tampered,
        PRODUCTION_ENVIRONMENT,
        ISSUED_AT_SECONDS,
      ),
    ).toBeNull()
  }

  expect(
    verifyAdvocateAttributionIdentityCookieValue(
      value,
      {
        ...PRODUCTION_ENVIRONMENT,
        ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1: OTHER_SECRET,
      },
      ISSUED_AT_SECONDS,
    ),
  ).toBeNull()
})

test("supports one previous signing key without signing new values with it", () => {
  const oldEnvironment = {
    NODE_ENV: "production",
    ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1: PREVIOUS_SECRET,
  }
  const rotatedEnvironment = {
    ...PRODUCTION_ENVIRONMENT,
    ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1_PREVIOUS: PREVIOUS_SECRET,
  }
  const oldValue = createCookieValue({}, oldEnvironment)
  const verification = verifyAdvocateAttributionIdentityCookieValue(
    oldValue,
    rotatedEnvironment,
    ISSUED_AT_SECONDS,
  )

  expect(verification?.signal.authUserId).toBe(AUTH_USER_ID)
  expect(verification?.requiresRefresh).toBe(true)
  expect(
    verifyAdvocateAttributionIdentityCookieValue(
      oldValue,
      PRODUCTION_ENVIRONMENT,
      ISSUED_AT_SECONDS,
    ),
  ).toBeNull()

  const newValue = createCookieValue({}, rotatedEnvironment)
  expect(
    verifyAdvocateAttributionIdentityCookieValue(
      newValue,
      rotatedEnvironment,
      ISSUED_AT_SECONDS,
    )?.requiresRefresh,
  ).toBe(false)
  expect(
    verifyAdvocateAttributionIdentityCookieValue(
      newValue,
      oldEnvironment,
      ISSUED_AT_SECONDS,
    ),
  ).toBeNull()

  expect(
    resolveAdvocateAttributionIdentityCookie(
      `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${oldValue}`,
      rotatedEnvironment,
      ISSUED_AT_SECONDS,
    ),
  ).toMatchObject({
    hadCandidates: true,
    requiresNormalization: true,
    requiresRefresh: true,
  })
})

test("fails closed for missing, invalid, shared, or ambiguous production secrets", () => {
  const validValue = createCookieValue()
  const invalidEnvironments = [
    { NODE_ENV: "production" },
    {
      NODE_ENV: "production",
      ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1: "not-base64",
    },
    {
      NODE_ENV: "production",
      ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1: Buffer.alloc(
        31,
        1,
      ).toString("base64"),
    },
    {
      ...PRODUCTION_ENVIRONMENT,
      SPONSORSHIP_CRYPTO_SECRET_V1: CURRENT_SECRET,
    },
    {
      ...PRODUCTION_ENVIRONMENT,
      SPONSORSHIP_VISITOR_COOKIE_SECRET_V1: CURRENT_SECRET,
    },
    {
      ...PRODUCTION_ENVIRONMENT,
      ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1_PREVIOUS: "not-base64",
    },
    {
      ...PRODUCTION_ENVIRONMENT,
      ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1_PREVIOUS: CURRENT_SECRET,
    },
    {
      ...PRODUCTION_ENVIRONMENT,
      ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_SECRET_V1_PREVIOUS: PREVIOUS_SECRET,
      SPONSORSHIP_VISITOR_COOKIE_SECRET_V1: PREVIOUS_SECRET,
    },
  ]

  for (const environment of invalidEnvironments) {
    expect(
      createAdvocateAttributionIdentityCookieValue(
        {
          authUserId: AUTH_USER_ID,
          issuedAtSeconds: ISSUED_AT_SECONDS,
          expiresAtSeconds: EXPIRES_AT_SECONDS,
        },
        environment,
      ),
    ).toBeNull()
    expect(
      verifyAdvocateAttributionIdentityCookieValue(
        validValue,
        environment,
        ISSUED_AT_SECONDS,
      ),
    ).toBeNull()
  }

  const localValue = createCookieValue({}, { NODE_ENV: "test" })
  expect(
    verifyAdvocateAttributionIdentityCookieValue(
      localValue,
      { NODE_ENV: "test" },
      ISSUED_AT_SECONDS,
    ),
  ).not.toBeNull()
})

test("rejects ambiguous duplicate cookies and normalizes exact duplicates", () => {
  const value = createCookieValue()
  const otherValue = createCookieValue({ authUserId: OTHER_AUTH_USER_ID })
  const cookie = `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${value}`
  const exactDuplicate = `${cookie}; ${cookie}`

  expect(
    readAdvocateAttributionIdentityCookie(
      cookie,
      PRODUCTION_ENVIRONMENT,
      ISSUED_AT_SECONDS,
    )?.authUserId,
  ).toBe(AUTH_USER_ID)
  expect(
    resolveAdvocateAttributionIdentityCookie(
      exactDuplicate,
      PRODUCTION_ENVIRONMENT,
      ISSUED_AT_SECONDS,
    ),
  ).toMatchObject({
    signal: { authUserId: AUTH_USER_ID },
    hadCandidates: true,
    requiresNormalization: true,
    requiresRefresh: false,
  })

  for (const ambiguous of [
    `${cookie}; ${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${otherValue}`,
    `${cookie}; ${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=forged`,
  ]) {
    expect(
      resolveAdvocateAttributionIdentityCookie(
        ambiguous,
        PRODUCTION_ENVIRONMENT,
        ISSUED_AT_SECONDS,
      ),
    ).toEqual({
      signal: null,
      hadCandidates: true,
      requiresNormalization: true,
      requiresRefresh: false,
    })
  }

  expect(
    resolveAdvocateAttributionIdentityCookie(
      "another_cookie=value",
      PRODUCTION_ENVIRONMENT,
      ISSUED_AT_SECONDS,
    ),
  ).toEqual({
    signal: null,
    hadCandidates: false,
    requiresNormalization: false,
    requiresRefresh: false,
  })
})

test("bounds cookie header and candidate processing", () => {
  const value = createCookieValue()
  const cookie = `${ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME}=${value}`
  const tooManyCandidates = Array(9).fill(cookie).join("; ")
  const oversizedHeader = `${cookie}; padding=${"x".repeat(32_768)}`

  for (const header of [tooManyCandidates, oversizedHeader]) {
    expect(
      resolveAdvocateAttributionIdentityCookie(
        header,
        PRODUCTION_ENVIRONMENT,
        ISSUED_AT_SECONDS,
      ),
    ).toEqual({
      signal: null,
      hadCandidates: true,
      requiresNormalization: true,
      requiresRefresh: false,
    })
  }
})

test("uses parent-domain production cookies and host-only preview or local cookies", () => {
  for (const host of [
    "creatorshare.com",
    "hope.creatorshare.com",
    "www.creatorshare.com",
    "hope.creatorshare.com:443",
  ]) {
    expect(getAdvocateAttributionIdentityCookieOptions(host, false)).toEqual({
      domain: ".creatorshare.com",
      httpOnly: true,
      maxAge: ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: true,
    })
  }

  expect(
    getAdvocateAttributionIdentityCookieOptions(
      "creator-share-preview.vercel.app",
      true,
    ),
  ).toEqual({
    httpOnly: true,
    maxAge: ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: true,
  })
  expect(
    getAdvocateAttributionIdentityCookieOptions("hope.localhost:3000", false),
  ).toEqual({
    httpOnly: true,
    maxAge: ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: false,
  })
  expect(
    getAdvocateAttributionIdentityCookieOptions(
      "hope.creatorshare.com.evil.example",
      true,
    ).domain,
  ).toBeUndefined()
})
