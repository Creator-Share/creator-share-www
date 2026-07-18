import "server-only"

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes as systemRandomBytes,
  timingSafeEqual,
} from "node:crypto"

export const SPONSOR_EMAIL_NORMALIZATION_VERSION = 1 as const
export const SPONSORSHIP_CRYPTO_KEY_VERSION = 1 as const
export const SPONSORSHIP_ENVELOPE_VERSION = 1 as const
export const SPONSORSHIP_CRYPTO_SECRET_ENV =
  "SPONSORSHIP_CRYPTO_SECRET_V1" as const

const MINIMUM_APP_SECRET_BYTES = 32
const MAXIMUM_APP_SECRET_BYTES = 1024
const OPAQUE_TOKEN_BYTES = 32
const SHA256_BYTES = 32
const AES_256_KEY_BYTES = 32
const GCM_NONCE_BYTES = 12
const GCM_AUTH_TAG_BYTES = 16
const MAX_SECRET_PAYLOAD_BYTES = 64 * 1024

const ENVELOPE_MAGIC = Buffer.from([0x43, 0x53])
const ENVELOPE_HEADER_BYTES = 6
const ENVELOPE_PURPOSE_RECIPIENT_EMAIL = 1
const ENVELOPE_PURPOSE_SECRET_PAYLOAD = 2
const ENVELOPE_AAD_PREFIX = Buffer.from(
  "creator-share/sponsorship/aes-256-gcm",
  "utf8",
)
const EMAIL_HMAC_CONTEXT = Buffer.from(
  "creator-share/sponsorship/email-hmac/v1\0",
  "utf8",
)
const KEY_DERIVATION_SALT = Buffer.from(
  "creator-share/sponsorship/key-derivation/v1",
  "utf8",
)
const EMAIL_HMAC_KEY_INFO = Buffer.from(
  "creator-share/sponsorship/email-hmac-key/v1",
  "utf8",
)
const ENVELOPE_KEY_INFO = Buffer.from(
  "creator-share/sponsorship/envelope-key/v1",
  "utf8",
)
const CHECKOUT_RECEIPT_HMAC_KEY_INFO = Buffer.from(
  "creator-share/sponsorship/checkout-receipt-hmac-key/v1",
  "utf8",
)
const CHECKOUT_RECEIPT_HMAC_CONTEXT = Buffer.from(
  "creator-share/sponsorship/checkout-receipt/v1\0",
  "utf8",
)

const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LOCAL_PART_PATTERN =
  /^[\p{L}\p{N}!#$%&'*+\-/=?^_`{|}~.]+$/u
const DOMAIN_LABEL_PATTERN =
  /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u

export type SponsorshipCryptoErrorCode =
  | "invalid-app-secret"
  | "invalid-email"
  | "invalid-envelope"
  | "invalid-payload"
  | "invalid-random-source"
  | "invalid-token"
  | "invalid-bytea"

/**
 * Errors are intentionally static. They must be safe to return through an
 * internal error boundary without copying a secret, email address, or token.
 */
export class SponsorshipCryptoError extends Error {
  readonly code: SponsorshipCryptoErrorCode

  constructor(code: SponsorshipCryptoErrorCode, message: string) {
    super(message)
    this.name = "SponsorshipCryptoError"
    this.code = code
  }
}

export type SupabaseRpcBytea = `\\x${string}`

export type SecureRandomBytes = (size: number) => Uint8Array

export interface SponsorshipCryptoDependencies {
  randomBytes?: SecureRandomBytes
}

export interface SponsorshipCryptoConfiguration {
  appSecretBase64: string
}

export type SponsorshipCryptoEnvironment = Readonly<
  Record<string, string | undefined>
>

export interface VersionedEmailDigest {
  normalizationVersion: typeof SPONSOR_EMAIL_NORMALIZATION_VERSION
  hmacKeyVersion: typeof SPONSORSHIP_CRYPTO_KEY_VERSION
  normalizedEmail: string
  digest: Buffer
  digestRpcBytea: SupabaseRpcBytea
}

export interface VersionedEncryptedEnvelope {
  envelopeVersion: typeof SPONSORSHIP_ENVELOPE_VERSION
  encryptionKeyVersion: typeof SPONSORSHIP_CRYPTO_KEY_VERSION
  ciphertext: Buffer
  ciphertextRpcBytea: SupabaseRpcBytea
}

export interface OpaqueToken {
  token: string
  digest: Buffer
  digestRpcBytea: SupabaseRpcBytea
}

export interface SponsorshipCrypto {
  digestEmail(email: string): VersionedEmailDigest
  encryptRecipientEmail(email: string): VersionedEncryptedEnvelope
  decryptRecipientEmail(envelope: Uint8Array): string
  encryptSecretPayload(
    payload: string | Uint8Array,
  ): VersionedEncryptedEnvelope
  decryptSecretPayload(envelope: Uint8Array): Buffer
  generateOpaqueToken(): OpaqueToken
  deriveCheckoutReceipt(operationId: string): OpaqueToken
  digestOpaqueToken(token: string): Buffer
}

function fail(
  code: SponsorshipCryptoErrorCode,
  message: string,
): SponsorshipCryptoError {
  return new SponsorshipCryptoError(code, message)
}

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8")
}

function hasValidDomain(domain: string): boolean {
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return false
  }

  const labels = domain.split(".")
  return labels.every(
    (label) =>
      utf8ByteLength(label) <= 63 && DOMAIN_LABEL_PATTERN.test(label),
  )
}

/**
 * Canonical sponsor email normalization, version 1.
 *
 * Provider-specific rewriting is deliberately forbidden. In particular, plus
 * tags and punctuation are identity-bearing input and remain untouched.
 */
export function normalizeSponsorEmailV1(email: string): string {
  if (typeof email !== "string" || utf8ByteLength(email) > 1024) {
    throw fail("invalid-email", "Invalid sponsor email")
  }

  const normalized = email.normalize("NFKC").trim().toLowerCase()
  const normalizedBytes = utf8ByteLength(normalized)

  if (
    normalizedBytes < 3 ||
    normalizedBytes > 254 ||
    /[\p{Cc}\p{Z}]/u.test(normalized)
  ) {
    throw fail("invalid-email", "Invalid sponsor email")
  }

  const separator = normalized.indexOf("@")
  if (separator <= 0 || separator !== normalized.lastIndexOf("@")) {
    throw fail("invalid-email", "Invalid sponsor email")
  }

  const localPart = normalized.slice(0, separator)
  const domain = normalized.slice(separator + 1)

  if (
    utf8ByteLength(localPart) > 64 ||
    utf8ByteLength(domain) > 253 ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    !LOCAL_PART_PATTERN.test(localPart) ||
    !hasValidDomain(domain)
  ) {
    throw fail("invalid-email", "Invalid sponsor email")
  }

  return normalized
}

function decodeAppSecret(appSecretBase64: unknown): Buffer {
  if (
    typeof appSecretBase64 !== "string" ||
    appSecretBase64.length === 0 ||
    appSecretBase64.length > 1368 ||
    appSecretBase64.length % 4 !== 0 ||
    !CANONICAL_BASE64_PATTERN.test(appSecretBase64)
  ) {
    throw fail("invalid-app-secret", "Invalid sponsorship cryptography key")
  }

  const secret = Buffer.from(appSecretBase64, "base64")
  if (
    secret.length < MINIMUM_APP_SECRET_BYTES ||
    secret.length > MAXIMUM_APP_SECRET_BYTES ||
    secret.toString("base64") !== appSecretBase64
  ) {
    throw fail("invalid-app-secret", "Invalid sponsorship cryptography key")
  }

  return secret
}

function deriveKey(appSecret: Buffer, info: Buffer): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      appSecret,
      KEY_DERIVATION_SALT,
      info,
      AES_256_KEY_BYTES,
    ),
  )
}

function secureRandomBytes(
  size: number,
  randomBytes: SecureRandomBytes,
): Buffer {
  let generated: Uint8Array
  try {
    generated = randomBytes(size)
  } catch {
    throw fail("invalid-random-source", "Secure random generation failed")
  }

  if (!(generated instanceof Uint8Array) || generated.byteLength !== size) {
    throw fail("invalid-random-source", "Secure random generation failed")
  }

  return Buffer.from(generated)
}

function purposeIdentifier(
  purpose: "recipient-email" | "secret-payload",
): number {
  return purpose === "recipient-email"
    ? ENVELOPE_PURPOSE_RECIPIENT_EMAIL
    : ENVELOPE_PURPOSE_SECRET_PAYLOAD
}

function envelopeHeader(purposeId: number): Buffer {
  return Buffer.from([
    ...ENVELOPE_MAGIC,
    SPONSORSHIP_ENVELOPE_VERSION,
    SPONSORSHIP_CRYPTO_KEY_VERSION,
    purposeId,
    GCM_NONCE_BYTES,
  ])
}

function envelopeAad(header: Buffer): Buffer {
  return Buffer.concat([ENVELOPE_AAD_PREFIX, Buffer.from([0]), header])
}

function encryptEnvelope(
  plaintext: Buffer,
  purpose: "recipient-email" | "secret-payload",
  encryptionKey: Buffer,
  randomBytes: SecureRandomBytes,
): VersionedEncryptedEnvelope {
  const header = envelopeHeader(purposeIdentifier(purpose))
  const nonce = secureRandomBytes(GCM_NONCE_BYTES, randomBytes)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce, {
    authTagLength: GCM_AUTH_TAG_BYTES,
  })
  cipher.setAAD(envelopeAad(header))

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const envelope = Buffer.concat([
    header,
    nonce,
    encrypted,
    cipher.getAuthTag(),
  ])

  return {
    envelopeVersion: SPONSORSHIP_ENVELOPE_VERSION,
    encryptionKeyVersion: SPONSORSHIP_CRYPTO_KEY_VERSION,
    ciphertext: envelope,
    ciphertextRpcBytea: toSupabaseRpcBytea(envelope),
  }
}

function decryptEnvelope(
  envelopeInput: Uint8Array,
  purpose: "recipient-email" | "secret-payload",
  encryptionKey: Buffer,
): Buffer {
  if (!(envelopeInput instanceof Uint8Array)) {
    throw fail("invalid-envelope", "Invalid sponsorship encryption envelope")
  }

  const envelope = Buffer.from(envelopeInput)
  const minimumLength =
    ENVELOPE_HEADER_BYTES + GCM_NONCE_BYTES + GCM_AUTH_TAG_BYTES + 1
  if (envelope.length < minimumLength) {
    throw fail("invalid-envelope", "Invalid sponsorship encryption envelope")
  }

  const header = envelope.subarray(0, ENVELOPE_HEADER_BYTES)
  const expectedHeader = envelopeHeader(purposeIdentifier(purpose))
  if (
    header.length !== expectedHeader.length ||
    !timingSafeEqual(header, expectedHeader)
  ) {
    throw fail("invalid-envelope", "Invalid sponsorship encryption envelope")
  }

  const nonceStart = ENVELOPE_HEADER_BYTES
  const ciphertextStart = nonceStart + GCM_NONCE_BYTES
  const authTagStart = envelope.length - GCM_AUTH_TAG_BYTES
  const nonce = envelope.subarray(nonceStart, ciphertextStart)
  const ciphertext = envelope.subarray(ciphertextStart, authTagStart)
  const authTag = envelope.subarray(authTagStart)

  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, nonce, {
      authTagLength: GCM_AUTH_TAG_BYTES,
    })
    decipher.setAAD(envelopeAad(header))
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw fail("invalid-envelope", "Invalid sponsorship encryption envelope")
  }
}

function payloadBuffer(payload: string | Uint8Array): Buffer {
  if (typeof payload !== "string" && !(payload instanceof Uint8Array)) {
    throw fail("invalid-payload", "Invalid sponsorship secret payload")
  }

  const bytes =
    typeof payload === "string"
      ? Buffer.from(payload, "utf8")
      : Buffer.from(payload)

  if (bytes.length === 0 || bytes.length > MAX_SECRET_PAYLOAD_BYTES) {
    throw fail("invalid-payload", "Invalid sponsorship secret payload")
  }

  return bytes
}

function decodeOpaqueToken(token: string): Buffer {
  if (typeof token !== "string" || !OPAQUE_TOKEN_PATTERN.test(token)) {
    throw fail("invalid-token", "Invalid sponsorship token")
  }

  const bytes = Buffer.from(token, "base64url")
  if (
    bytes.length !== OPAQUE_TOKEN_BYTES ||
    bytes.toString("base64url") !== token
  ) {
    throw fail("invalid-token", "Invalid sponsorship token")
  }

  return bytes
}

export function sha256Digest(value: Uint8Array): Buffer {
  if (!(value instanceof Uint8Array)) {
    throw fail("invalid-bytea", "Invalid binary value")
  }

  return createHash("sha256").update(value).digest()
}

/**
 * Encode binary data in PostgreSQL's canonical hex bytea input form. Supabase
 * RPC transports this string through JSON without any lossy text conversion.
 */
export function toSupabaseRpcBytea(value: Uint8Array): SupabaseRpcBytea {
  if (!(value instanceof Uint8Array)) {
    throw fail("invalid-bytea", "Invalid binary value")
  }

  return `\\x${Buffer.from(value).toString("hex")}`
}

export function fromSupabaseRpcBytea(value: string): Buffer {
  if (
    typeof value !== "string" ||
    !/^\\x(?:[0-9a-fA-F]{2})*$/.test(value)
  ) {
    throw fail("invalid-bytea", "Invalid binary value")
  }

  return Buffer.from(value.slice(2), "hex")
}

/** Compare SHA-256 digests without a data-dependent byte comparison. */
export function constantTimeDigestEqual(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (
    !(left instanceof Uint8Array) ||
    !(right instanceof Uint8Array) ||
    left.byteLength !== SHA256_BYTES ||
    right.byteLength !== SHA256_BYTES
  ) {
    return false
  }

  return timingSafeEqual(Buffer.from(left), Buffer.from(right))
}

export function createSponsorshipCrypto(
  configuration: SponsorshipCryptoConfiguration,
  dependencies: SponsorshipCryptoDependencies = {},
): SponsorshipCrypto {
  const appSecret = decodeAppSecret(configuration?.appSecretBase64)
  const emailHmacKey = deriveKey(appSecret, EMAIL_HMAC_KEY_INFO)
  const encryptionKey = deriveKey(appSecret, ENVELOPE_KEY_INFO)
  const checkoutReceiptHmacKey = deriveKey(
    appSecret,
    CHECKOUT_RECEIPT_HMAC_KEY_INFO,
  )
  appSecret.fill(0)

  const randomBytes = dependencies.randomBytes ?? systemRandomBytes

  return {
    digestEmail(email: string): VersionedEmailDigest {
      const normalizedEmail = normalizeSponsorEmailV1(email)
      const digest = createHmac("sha256", emailHmacKey)
        .update(EMAIL_HMAC_CONTEXT)
        .update(normalizedEmail, "utf8")
        .digest()

      return {
        normalizationVersion: SPONSOR_EMAIL_NORMALIZATION_VERSION,
        hmacKeyVersion: SPONSORSHIP_CRYPTO_KEY_VERSION,
        normalizedEmail,
        digest,
        digestRpcBytea: toSupabaseRpcBytea(digest),
      }
    },

    encryptRecipientEmail(email: string): VersionedEncryptedEnvelope {
      const normalizedEmail = normalizeSponsorEmailV1(email)
      return encryptEnvelope(
        Buffer.from(normalizedEmail, "utf8"),
        "recipient-email",
        encryptionKey,
        randomBytes,
      )
    },

    decryptRecipientEmail(envelope: Uint8Array): string {
      const plaintext = decryptEnvelope(
        envelope,
        "recipient-email",
        encryptionKey,
      )

      try {
        const email = new TextDecoder("utf-8", { fatal: true }).decode(plaintext)
        const normalizedEmail = normalizeSponsorEmailV1(email)
        if (normalizedEmail !== email) {
          throw fail("invalid-envelope", "Invalid sponsorship encryption envelope")
        }
        return normalizedEmail
      } catch {
        throw fail("invalid-envelope", "Invalid sponsorship encryption envelope")
      } finally {
        plaintext.fill(0)
      }
    },

    encryptSecretPayload(
      payload: string | Uint8Array,
    ): VersionedEncryptedEnvelope {
      const plaintext = payloadBuffer(payload)
      try {
        return encryptEnvelope(
          plaintext,
          "secret-payload",
          encryptionKey,
          randomBytes,
        )
      } finally {
        plaintext.fill(0)
      }
    },

    decryptSecretPayload(envelope: Uint8Array): Buffer {
      return decryptEnvelope(envelope, "secret-payload", encryptionKey)
    },

    generateOpaqueToken(): OpaqueToken {
      const tokenBytes = secureRandomBytes(OPAQUE_TOKEN_BYTES, randomBytes)
      try {
        const token = tokenBytes.toString("base64url")
        const digest = sha256Digest(tokenBytes)
        return {
          token,
          digest,
          digestRpcBytea: toSupabaseRpcBytea(digest),
        }
      } finally {
        tokenBytes.fill(0)
      }
    },

    deriveCheckoutReceipt(operationId: string): OpaqueToken {
      if (typeof operationId !== "string" || !UUID_PATTERN.test(operationId)) {
        throw fail("invalid-token", "Invalid sponsorship token")
      }

      const receiptBytes = createHmac("sha256", checkoutReceiptHmacKey)
        .update(CHECKOUT_RECEIPT_HMAC_CONTEXT)
        .update(operationId.toLowerCase(), "utf8")
        .digest()
      const token = receiptBytes.toString("base64url")
      const digest = sha256Digest(receiptBytes)

      return {
        token,
        digest,
        digestRpcBytea: toSupabaseRpcBytea(digest),
      }
    },

    digestOpaqueToken(token: string): Buffer {
      const tokenBytes = decodeOpaqueToken(token)
      try {
        return sha256Digest(tokenBytes)
      } finally {
        tokenBytes.fill(0)
      }
    },
  }
}

export function createSponsorshipCryptoFromEnvironment(
  environment: SponsorshipCryptoEnvironment = process.env,
  dependencies: SponsorshipCryptoDependencies = {},
): SponsorshipCrypto {
  const appSecretBase64 = environment[SPONSORSHIP_CRYPTO_SECRET_ENV]
  if (!appSecretBase64) {
    throw fail("invalid-app-secret", "Sponsorship cryptography key is missing")
  }

  return createSponsorshipCrypto({ appSecretBase64 }, dependencies)
}
