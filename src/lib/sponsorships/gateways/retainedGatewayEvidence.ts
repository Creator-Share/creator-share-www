import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"
import type Stripe from "stripe"

import {
  fromSupabaseRpcBytea,
  type SponsorshipCrypto,
  type SupabaseRpcBytea,
} from "@/lib/sponsorships/crypto"
import {
  parsePayPalWebhookEvent,
  paypalEventImmutableDigest,
  type PayPalWebhookEvent,
} from "./paypalWebhook"
import {
  stripeEventImmutableDigest,
  validateStripeEventAccountEnvelope,
} from "./stripeWebhook"

export interface RetainedGatewayEvidence {
  provider: "STRIPE" | "PAYPAL"
  providerAccountScope: string
  providerEventId: string
  eventType: string
  verificationMethod: string
  signatureVerifiedAt: string
  payloadRetentionExpiresAt: string
  payloadCiphertext: SupabaseRpcBytea | null
  payloadSha256: SupabaseRpcBytea
  deliveryPayloadSha256: string
}

type RecoveryAccount =
  | { providerAccountScope: "stripe_us" | "stripe_uk"; stripeLivemode: boolean }
  | { providerAccountScope: "paypal" }

type DecodedEvidence =
  | { provider: "STRIPE"; event: Stripe.Event; rawPayload: string }
  | { provider: "PAYPAL"; event: PayPalWebhookEvent; rawPayload: string }

export class RetainedGatewayEvidenceError extends Error {
  constructor(readonly code: "unavailable" | "expired" | "incomplete" | "invalid") {
    super("Retained payment evidence cannot be revalidated")
    this.name = "RetainedGatewayEvidenceError"
  }
}

function reject(code: RetainedGatewayEvidenceError["code"]): never {
  throw new RetainedGatewayEvidenceError(code)
}

/**
 * Read only from the protected event record, never from an administrator body.
 * This checks retained evidence, not a fresh provider signature or settlement
 * authority. Callers must still validate supported event versions, current
 * account configuration and payment chains.
 */
export function decodeRetainedGatewayEvidence(
  evidence: RetainedGatewayEvidence,
  account: RecoveryAccount,
  crypto: Pick<SponsorshipCrypto, "decryptSecretPayload">,
  now: Date,
): DecodedEvidence {
  let plaintext: Buffer | undefined
  try {
    const currentTime = now.getTime()
    const verifiedAt = Date.parse(evidence.signatureVerifiedAt)
    const expiresAt = Date.parse(evidence.payloadRetentionExpiresAt)
    if (!Number.isFinite(currentTime) || !Number.isFinite(verifiedAt) ||
        !Number.isFinite(expiresAt) || verifiedAt > currentTime ||
        evidence.providerAccountScope !== account.providerAccountScope) reject("invalid")
    if (expiresAt <= currentTime) reject("expired")
    if (evidence.payloadCiphertext === null) reject("unavailable")
    if (evidence.payloadCiphertext.length > 2 + 2 * 1048576) reject("invalid")
    const ciphertext = fromSupabaseRpcBytea(evidence.payloadCiphertext)
    plaintext = crypto.decryptSecretPayload(ciphertext)
    if (plaintext.length < 1 || plaintext.length > 64 * 1024) reject("invalid")
    const rawPayload = new TextDecoder("utf-8", { fatal: true }).decode(plaintext)
    const parsed: unknown = JSON.parse(rawPayload)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) reject("invalid")
    if (evidence.provider === "PAYPAL" && "evidence_version" in parsed &&
        parsed.evidence_version === "paypal_unsupported_v1") reject("incomplete")
    if (!/^[0-9a-f]{64}$/.test(evidence.deliveryPayloadSha256) ||
        !timingSafeEqual(createHash("sha256").update(plaintext).digest(),
          Buffer.from(evidence.deliveryPayloadSha256, "hex"))) reject("invalid")
    if (evidence.payloadSha256.length !== 66) reject("invalid")
    const expectedDigest = fromSupabaseRpcBytea(evidence.payloadSha256)
    if (expectedDigest.length !== 32) reject("invalid")
    if (evidence.provider === "STRIPE" && account.providerAccountScope !== "paypal") {
      if (evidence.verificationMethod !== "stripe_webhook_signature") reject("invalid")
      const event = parsed as Stripe.Event
      validateStripeEventAccountEnvelope(event, account.stripeLivemode)
      if (event.id !== evidence.providerEventId || event.type !== evidence.eventType ||
          !timingSafeEqual(stripeEventImmutableDigest(event), expectedDigest)) reject("invalid")
      return { provider: "STRIPE", event, rawPayload }
    }
    if (evidence.provider === "PAYPAL" && account.providerAccountScope === "paypal") {
      if (evidence.verificationMethod !== "paypal_webhook_signature_api") reject("invalid")
      const event = parsePayPalWebhookEvent(rawPayload)
      if (event.id !== evidence.providerEventId || event.eventType !== evidence.eventType ||
          !timingSafeEqual(paypalEventImmutableDigest(event), expectedDigest)) reject("invalid")
      return { provider: "PAYPAL", event, rawPayload }
    }
    return reject("invalid")
  } catch (error) {
    if (error instanceof RetainedGatewayEvidenceError) throw error
    // Decryption and parser errors can contain contact or provider material.
    return reject("invalid")
  } finally {
    plaintext?.fill(0)
  }
}
