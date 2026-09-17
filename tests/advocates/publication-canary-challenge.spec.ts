import { createHmac } from "node:crypto"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type ChallengeModule =
  typeof import("../../src/lib/advocates/publicationCanary/challenge")
type PublicationCanaryEnvironment =
  import("../../src/lib/advocates/publicationCanary/challenge").PublicationCanaryEnvironment
type PublicationCanaryRandomBytes =
  import("../../src/lib/advocates/publicationCanary/challenge").PublicationCanaryRandomBytes
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
  resolve(
    process.cwd(),
    "tests/advocates/publication-canary-challenge.spec.ts",
  ),
)
const challenge = testRequire(
  "../../src/lib/advocates/publicationCanary/challenge",
) as ChallengeModule
nodeModule._load = originalModuleLoad

const NOW = Date.parse("2026-07-18T12:00:00.000Z")
const SECRET = Buffer.alloc(32, 17).toString("base64")
const OTHER_SECRET = Buffer.alloc(32, 18).toString("base64")
const DEPLOYMENT_ID = "dpl_publication_canary_123"
const REVISION = "a".repeat(40)
const RUN_ID = "11111111-1111-4111-8111-111111111111"
const ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"
const DOMAIN_ID = "33333333-3333-4333-8333-333333333333"
const HOSTNAME = "hope.creatorshare.com"
const ENVIRONMENT = Object.freeze({
  NODE_ENV: "production",
  ADVOCATE_PUBLICATION_CANARY_SECRET_V1: SECRET,
  VERCEL_DEPLOYMENT_ID: DEPLOYMENT_ID,
  VERCEL_GIT_COMMIT_SHA: REVISION,
})

const TOKEN_INPUT = Object.freeze({
  runId: RUN_ID,
  advocateId: ADVOCATE_ID,
  domainId: DOMAIN_ID,
  hostname: HOSTNAME,
  advocateVersion: 7,
  deploymentId: DEPLOYMENT_ID,
  revision: REVISION,
})

function createToken(
  input: Parameters<
    typeof challenge.createPublicationCanaryToken
  >[0] = TOKEN_INPUT,
  now = NOW,
  environment: PublicationCanaryEnvironment = ENVIRONMENT,
  randomBytes?: PublicationCanaryRandomBytes,
) {
  return challenge.createPublicationCanaryToken(input, {
    environment,
    now: () => now,
    randomBytes,
  })
}

function verifyToken(token: string, now = NOW, environment = ENVIRONMENT) {
  return challenge.verifyPublicationCanaryToken(token, {
    environment,
    now: () => now,
  })
}

function signedTokenPayload(value: unknown, indentation?: number): string {
  const payload = Buffer.from(
    JSON.stringify(value, null, indentation),
    "utf8",
  ).toString("base64url")
  const mac = createHmac("sha256", Buffer.from(SECRET, "base64"))
    .update(
      Buffer.from(
        "creator-share/advocate-publication-canary/token/v1\0",
        "utf8",
      ),
    )
    .update(payload, "utf8")
    .digest("base64url")
  return `v1.${payload}.${mac}`
}

test.describe("advocate publication canary challenge token", () => {
  test("binds one exact target, deployment, revision, run, version, and lifetime", () => {
    const token = createToken()
    const claims = verifyToken(token)

    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/)
    expect(claims).toEqual({
      schemaVersion: 1,
      purpose: "advocate-publication-canary",
      keyId: "v1",
      ...TOKEN_INPUT,
      nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      issuedAt: Math.floor(NOW / 1_000),
      expiresAt:
        Math.floor(NOW / 1_000) +
        challenge.ADVOCATE_PUBLICATION_CANARY_MAX_TTL_SECONDS,
    })
  })

  test("rejects forgery, the wrong key, expiry, excess lifetime, and future issuance", () => {
    const token = createToken()
    const forged = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`

    expect(verifyToken(forged)).toBeNull()
    expect(
      verifyToken(token, NOW, {
        ...ENVIRONMENT,
        ADVOCATE_PUBLICATION_CANARY_SECRET_V1: OTHER_SECRET,
      }),
    ).toBeNull()
    expect(
      verifyToken(createToken({ ...TOKEN_INPUT, ttlSeconds: 1 }, NOW - 1_000)),
    ).toBeNull()
    expect(() =>
      createToken({
        ...TOKEN_INPUT,
        ttlSeconds: challenge.ADVOCATE_PUBLICATION_CANARY_MAX_TTL_SECONDS + 1,
      }),
    ).toThrow(challenge.PublicationCanaryConfigurationError)
    expect(verifyToken(createToken(TOKEN_INPUT, NOW + 31_000))).toBeNull()
    expect(verifyToken(createToken(TOKEN_INPUT, NOW + 30_000))).not.toBeNull()
  })

  test("requires one canonical dedicated 32 byte base64 key", () => {
    for (const invalidSecret of [
      "",
      "not-base64",
      Buffer.alloc(31, 1).toString("base64"),
      Buffer.alloc(33, 1).toString("base64"),
      SECRET.replace(/=$/, ""),
      `${SECRET}\n`,
    ]) {
      expect(() =>
        createToken(TOKEN_INPUT, NOW, {
          ...ENVIRONMENT,
          ADVOCATE_PUBLICATION_CANARY_SECRET_V1: invalidSecret,
        }),
      ).toThrow(challenge.PublicationCanaryConfigurationError)
    }

    expect(() =>
      createToken(TOKEN_INPUT, NOW, {
        ...ENVIRONMENT,
        SPONSORSHIP_CRYPTO_SECRET_V1: SECRET,
      }),
    ).toThrow(challenge.PublicationCanaryConfigurationError)
  })

  test("rejects noncanonical claims even when their MAC is valid", () => {
    const claims = verifyToken(createToken())
    expect(claims).not.toBeNull()
    if (claims === null) throw new Error("Expected challenge claims")

    expect(verifyToken(signedTokenPayload({ ...claims }, 1))).toBeNull()
  })

  test("generates a fresh canonical nonce through the injectable secure source", () => {
    let seed = 1
    const randomBytes = (size: number) => Buffer.alloc(size, seed++)
    const first = verifyToken(
      createToken(TOKEN_INPUT, NOW, ENVIRONMENT, randomBytes),
    )
    const second = verifyToken(
      createToken(TOKEN_INPUT, NOW, ENVIRONMENT, randomBytes),
    )

    expect(first?.nonce).toBe(Buffer.alloc(32, 1).toString("base64url"))
    expect(second?.nonce).toBe(Buffer.alloc(32, 2).toString("base64url"))
    expect(first?.nonce).not.toBe(second?.nonce)
    expect(() =>
      createToken(TOKEN_INPUT, NOW, ENVIRONMENT, (size) =>
        Buffer.alloc(size - 1),
      ),
    ).toThrow(challenge.PublicationCanaryConfigurationError)
  })

  test("rejects a malformed nonce or unknown key id even under a valid MAC", () => {
    const claims = verifyToken(createToken())
    expect(claims).not.toBeNull()
    if (claims === null) throw new Error("Expected challenge claims")

    expect(
      verifyToken(signedTokenPayload({ ...claims, nonce: "a".repeat(42) })),
    ).toBeNull()
    expect(
      verifyToken(signedTokenPayload({ ...claims, nonce: "!".repeat(43) })),
    ).toBeNull()
    expect(
      verifyToken(signedTokenPayload({ ...claims, keyId: "v2" })),
    ).toBeNull()
  })

  test("refuses malformed identity and immutable build claims", () => {
    for (const input of [
      { ...TOKEN_INPUT, runId: "AAAAAAAA-1111-4111-8111-111111111111" },
      { ...TOKEN_INPUT, hostname: HOSTNAME.toUpperCase() },
      { ...TOKEN_INPUT, hostname: "admin.creatorshare.com" },
      { ...TOKEN_INPUT, hostname: `nested.${HOSTNAME}` },
      { ...TOKEN_INPUT, advocateVersion: 0 },
      { ...TOKEN_INPUT, deploymentId: "deployment id with spaces" },
      { ...TOKEN_INPUT, revision: REVISION.toUpperCase() },
    ]) {
      expect(() => createToken(input)).toThrow(
        challenge.PublicationCanaryConfigurationError,
      )
    }
  })
})
