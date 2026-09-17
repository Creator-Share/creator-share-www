import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import Module, { createRequire } from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type SponsorshipCryptoModule =
  typeof import("../../src/lib/sponsorships/crypto")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

/* Playwright does not apply Next.js's server-only test alias. Mock only the
 * poison-pill marker while synchronously loading this server module. */
const nodeModule = Module as unknown as {
  _load: NodeModuleLoader
}
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
  resolve(process.cwd(), "tests/sponsorships/crypto.spec.ts"),
)
const sponsorshipCrypto = testRequire(
  "../../src/lib/sponsorships/crypto",
) as SponsorshipCryptoModule
nodeModule._load = originalModuleLoad

const {
  SPONSOR_EMAIL_NORMALIZATION_VERSION,
  SPONSORSHIP_CRYPTO_KEY_VERSION,
  SPONSORSHIP_CRYPTO_SECRET_ENV,
  SPONSORSHIP_ENVELOPE_VERSION,
  SponsorshipCryptoError,
  constantTimeDigestEqual,
  createSponsorshipCrypto,
  createSponsorshipCryptoFromEnvironment,
  fromSupabaseRpcBytea,
  normalizeSponsorEmailV1,
  toSupabaseRpcBytea,
} = sponsorshipCrypto

type SponsorshipCryptoErrorInstance = InstanceType<
  typeof SponsorshipCryptoError
>

const APP_SECRET = Buffer.from(
  "creator-share-test-secret-material-v1-0000000000000000",
  "utf8",
).toString("base64")
const OTHER_APP_SECRET = Buffer.from(
  "creator-share-test-secret-material-v1-1111111111111111",
  "utf8",
).toString("base64")

function sequentialRandomBytes() {
  let invocation = 0
  return (size: number): Uint8Array => {
    invocation += 1
    return Buffer.alloc(size, invocation)
  }
}

function expectCryptoError(
  callback: () => unknown,
  code: SponsorshipCryptoErrorInstance["code"],
) {
  try {
    callback()
    throw new Error("Expected sponsorship cryptography operation to fail")
  } catch (error) {
    expect(error).toBeInstanceOf(SponsorshipCryptoError)
    expect((error as SponsorshipCryptoErrorInstance).code).toBe(code)
    return error as SponsorshipCryptoErrorInstance
  }
}

test.describe("sponsor email normalization and HMAC", () => {
  test("normalizes with NFKC, trim, and lowercase without provider rewriting", () => {
    expect(
      normalizeSponsorEmailV1("  Ａlice.Sponsor+Launch@Ｅxample.COM  "),
    ).toBe("alice.sponsor+launch@example.com")
    expect(normalizeSponsorEmailV1("First.Last+tag@gmail.com")).toBe(
      "first.last+tag@gmail.com",
    )
    expect(normalizeSponsorEmailV1("Usér@Exämple.com")).toBe("usér@exämple.com")
  })

  test("enforces practical email syntax and UTF-8 octet bounds", () => {
    const invalidEmails = [
      "",
      "plain-address",
      "two@@example.com",
      ".first@example.com",
      "last.@example.com",
      "two..dots@example.com",
      "space inside@example.com",
      "line@example.com\nBcc: victim@example.com",
      'quoted"local@example.com',
      "local@[127.0.0.1]",
      "user@-example.com",
      "user@example-.com",
      "user@example..com",
      `${"a".repeat(65)}@example.com`,
      `user@${"a".repeat(64)}.com`,
      `${"é".repeat(33)}@example.com`,
    ]

    for (const email of invalidEmails) {
      expectCryptoError(() => normalizeSponsorEmailV1(email), "invalid-email")
    }
  })

  test("produces stable, versioned, domain-separated HMAC digests", () => {
    const crypto = createSponsorshipCrypto({ appSecretBase64: APP_SECRET })
    const first = crypto.digestEmail(" Sponsor+News@Example.com ")
    const second = crypto.digestEmail("sponsor+news@example.com")
    const otherKey = createSponsorshipCrypto({
      appSecretBase64: OTHER_APP_SECRET,
    }).digestEmail("sponsor+news@example.com")

    expect(first.normalizationVersion).toBe(SPONSOR_EMAIL_NORMALIZATION_VERSION)
    expect(first.hmacKeyVersion).toBe(SPONSORSHIP_CRYPTO_KEY_VERSION)
    expect(first.normalizedEmail).toBe("sponsor+news@example.com")
    expect(first.digest).toHaveLength(32)
    expect(first.digest.toString("hex")).toBe(
      "c729309cfc8b6c0711cf70af6b31ce4c87e7ffbce49c8a1f2a53962f9d9937f2",
    )
    expect(first.digest.equals(second.digest)).toBe(true)
    expect(first.digest.equals(otherKey.digest)).toBe(false)
    expect(first.digestRpcBytea).toBe(toSupabaseRpcBytea(first.digest))
  })
})

test.describe("sponsorship cryptography key handling", () => {
  test("accepts a canonical base64 secret of at least 32 bytes", () => {
    expect(() =>
      createSponsorshipCrypto({
        appSecretBase64: Buffer.alloc(32, 7).toString("base64"),
      }),
    ).not.toThrow()
  })

  test("rejects short, malformed, noncanonical, and oversized secrets", () => {
    const sensitiveSecret = "raw-secret-that-must-never-appear"
    const invalidSecrets = [
      sensitiveSecret,
      Buffer.alloc(31, 7).toString("base64"),
      Buffer.alloc(32, 7).toString("base64").replace(/=$/, ""),
      `${Buffer.alloc(32, 7).toString("base64")}\n`,
      Buffer.alloc(1025, 7).toString("base64"),
    ]

    for (const appSecretBase64 of invalidSecrets) {
      const error = expectCryptoError(
        () => createSponsorshipCrypto({ appSecretBase64 }),
        "invalid-app-secret",
      )
      expect(error.message).not.toContain(appSecretBase64)
      expect(error.message).not.toContain(sensitiveSecret)
    }

    expectCryptoError(
      () =>
        createSponsorshipCrypto(
          undefined as unknown as { appSecretBase64: string },
        ),
      "invalid-app-secret",
    )
  })

  test("loads the numbered server secret through an injectable environment", () => {
    expect(
      createSponsorshipCryptoFromEnvironment({
        [SPONSORSHIP_CRYPTO_SECRET_ENV]: APP_SECRET,
      }).digestEmail("family@example.com").digest,
    ).toHaveLength(32)

    expectCryptoError(
      () => createSponsorshipCryptoFromEnvironment({}),
      "invalid-app-secret",
    )
  })
})

test.describe("versioned AES-256-GCM envelopes", () => {
  test("round trips normalized recipient emails with unique nonces", () => {
    const crypto = createSponsorshipCrypto(
      { appSecretBase64: APP_SECRET },
      { randomBytes: sequentialRandomBytes() },
    )
    const first = crypto.encryptRecipientEmail(" Family+One@Example.com ")
    const second = crypto.encryptRecipientEmail("family+one@example.com")

    expect(first.envelopeVersion).toBe(SPONSORSHIP_ENVELOPE_VERSION)
    expect(first.encryptionKeyVersion).toBe(SPONSORSHIP_CRYPTO_KEY_VERSION)
    expect([...first.ciphertext.subarray(0, 6)]).toEqual([
      0x43, 0x53, 1, 1, 1, 12,
    ])
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false)
    expect(
      first.ciphertext
        .subarray(6, 18)
        .equals(second.ciphertext.subarray(6, 18)),
    ).toBe(false)
    expect(crypto.decryptRecipientEmail(first.ciphertext)).toBe(
      "family+one@example.com",
    )
    expect(first.ciphertextRpcBytea).toBe(toSupabaseRpcBytea(first.ciphertext))
  })

  test("round trips text and binary secret payloads", () => {
    const crypto = createSponsorshipCrypto(
      { appSecretBase64: APP_SECRET },
      { randomBytes: sequentialRandomBytes() },
    )
    const textEnvelope = crypto.encryptSecretPayload(
      JSON.stringify({ claimToken: "opaque-value" }),
    )
    const binaryEnvelope = crypto.encryptSecretPayload(
      Buffer.from([0, 1, 2, 255]),
    )

    expect([...textEnvelope.ciphertext.subarray(0, 6)]).toEqual([
      0x43, 0x53, 1, 1, 2, 12,
    ])
    expect(
      crypto.decryptSecretPayload(textEnvelope.ciphertext).toString(),
    ).toBe('{"claimToken":"opaque-value"}')
    expect([...crypto.decryptSecretPayload(binaryEnvelope.ciphertext)]).toEqual(
      [0, 1, 2, 255],
    )
  })

  test("binds authentication to the envelope purpose", () => {
    const crypto = createSponsorshipCrypto(
      { appSecretBase64: APP_SECRET },
      { randomBytes: sequentialRandomBytes() },
    )
    const emailEnvelope = crypto.encryptRecipientEmail("family@example.com")
    const payloadEnvelope = crypto.encryptSecretPayload("family@example.com")

    expectCryptoError(
      () => crypto.decryptSecretPayload(emailEnvelope.ciphertext),
      "invalid-envelope",
    )
    expectCryptoError(
      () => crypto.decryptRecipientEmail(payloadEnvelope.ciphertext),
      "invalid-envelope",
    )
  })

  test("rejects malformed, tampered, truncated, and wrong-key envelopes", () => {
    const crypto = createSponsorshipCrypto(
      { appSecretBase64: APP_SECRET },
      { randomBytes: sequentialRandomBytes() },
    )
    const envelope = crypto.encryptSecretPayload("private payload").ciphertext
    const wrongKeyCrypto = createSponsorshipCrypto({
      appSecretBase64: OTHER_APP_SECRET,
    })

    const tamperedHeader = Buffer.from(envelope)
    tamperedHeader[2] = 99
    const tamperedNonce = Buffer.from(envelope)
    tamperedNonce[8] ^= 1
    const tamperedCiphertext = Buffer.from(envelope)
    tamperedCiphertext[19] ^= 1
    const tamperedTag = Buffer.from(envelope)
    tamperedTag[tamperedTag.length - 1] ^= 1

    for (const candidate of [
      Buffer.alloc(0),
      envelope.subarray(0, 33),
      tamperedHeader,
      tamperedNonce,
      tamperedCiphertext,
      tamperedTag,
    ]) {
      expectCryptoError(
        () => crypto.decryptSecretPayload(candidate),
        "invalid-envelope",
      )
    }

    expectCryptoError(
      () => wrongKeyCrypto.decryptSecretPayload(envelope),
      "invalid-envelope",
    )
  })

  test("rejects empty, oversized, and invalid payload input", () => {
    const crypto = createSponsorshipCrypto({ appSecretBase64: APP_SECRET })

    expectCryptoError(() => crypto.encryptSecretPayload(""), "invalid-payload")
    expectCryptoError(
      () => crypto.encryptSecretPayload(Buffer.alloc(64 * 1024 + 1)),
      "invalid-payload",
    )
    expectCryptoError(
      () => crypto.encryptSecretPayload(null as unknown as Uint8Array),
      "invalid-payload",
    )
  })
})

test.describe("opaque tokens, digests, and Supabase bytea", () => {
  test("generates unique 256-bit base64url tokens and SHA-256 digests", () => {
    const crypto = createSponsorshipCrypto(
      { appSecretBase64: APP_SECRET },
      { randomBytes: sequentialRandomBytes() },
    )
    const first = crypto.generateOpaqueToken()
    const second = crypto.generateOpaqueToken()
    const decoded = Buffer.from(first.token, "base64url")

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(decoded).toHaveLength(32)
    expect(first.token).not.toBe(second.token)
    expect(first.digest).toEqual(createHash("sha256").update(decoded).digest())
    expect(crypto.digestOpaqueToken(first.token)).toEqual(first.digest)
    expect(first.digestRpcBytea).toBe(toSupabaseRpcBytea(first.digest))
  })

  test("derives stable, secret-bound checkout receipts from exact operation ids", () => {
    const operationId = "44444444-4444-4444-8444-444444444444"
    const crypto = createSponsorshipCrypto({ appSecretBase64: APP_SECRET })
    const sameKey = createSponsorshipCrypto({ appSecretBase64: APP_SECRET })
    const otherKey = createSponsorshipCrypto({
      appSecretBase64: OTHER_APP_SECRET,
    })

    const first = crypto.deriveCheckoutReceipt(operationId)
    const replay = sameKey.deriveCheckoutReceipt(operationId.toUpperCase())
    const unrelated = crypto.deriveCheckoutReceipt(
      "55555555-5555-4555-8555-555555555555",
    )

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.token).toBe(replay.token)
    expect(first.digest).toEqual(replay.digest)
    expect(first.token).not.toBe(unrelated.token)
    expect(first.token).not.toBe(
      otherKey.deriveCheckoutReceipt(operationId).token,
    )
    expect(crypto.digestOpaqueToken(first.token)).toEqual(first.digest)
    expectCryptoError(
      () => crypto.deriveCheckoutReceipt("not-an-operation-id"),
      "invalid-token",
    )
  })

  test("rejects malformed tokens and never copies a token into its error", () => {
    const crypto = createSponsorshipCrypto({ appSecretBase64: APP_SECRET })
    const rawToken = `${"a".repeat(42)}!`
    const error = expectCryptoError(
      () => crypto.digestOpaqueToken(rawToken),
      "invalid-token",
    )

    expect(error.message).not.toContain(rawToken)
  })

  test("compares only 32-byte digests in constant time", () => {
    const first = createHash("sha256").update("one").digest()
    const same = Buffer.from(first)
    const other = createHash("sha256").update("two").digest()

    expect(constantTimeDigestEqual(first, same)).toBe(true)
    expect(constantTimeDigestEqual(first, other)).toBe(false)
    expect(constantTimeDigestEqual(first, Buffer.alloc(31))).toBe(false)
    expect(constantTimeDigestEqual(null as unknown as Uint8Array, other)).toBe(
      false,
    )
  })

  test("encodes canonical PostgreSQL bytea through JSON without ambiguity", () => {
    const encoded = toSupabaseRpcBytea(Buffer.from([0, 1, 254, 255]))

    expect(encoded).toBe("\\x0001feff")
    expect(JSON.stringify({ target_digest: encoded })).toBe(
      '{"target_digest":"\\\\x0001feff"}',
    )
    expect(fromSupabaseRpcBytea(encoded)).toEqual(Buffer.from([0, 1, 254, 255]))
    expect(fromSupabaseRpcBytea("\\xA0ff")).toEqual(Buffer.from([160, 255]))

    for (const value of ["", "x00", "\\x0", "\\x0g", "base64-value"]) {
      expectCryptoError(() => fromSupabaseRpcBytea(value), "invalid-bytea")
    }
  })

  test("rejects broken injected entropy sources with static errors", () => {
    for (const randomBytes of [
      () => Buffer.alloc(1),
      () => {
        throw new Error("sensitive entropy backend detail")
      },
    ]) {
      const crypto = createSponsorshipCrypto(
        { appSecretBase64: APP_SECRET },
        { randomBytes },
      )
      const error = expectCryptoError(
        () => crypto.generateOpaqueToken(),
        "invalid-random-source",
      )
      expect(error.message).not.toContain("sensitive entropy backend detail")
    }
  })
})

test("module is explicitly poisoned against browser imports", async () => {
  const modulePath = resolve(process.cwd(), "src/lib/sponsorships/crypto.ts")
  const source = await readFile(modulePath, "utf8")

  expect(source).toMatch(/^import ["']server-only["']/)
  expect(source).toContain('from "node:crypto"')
})
