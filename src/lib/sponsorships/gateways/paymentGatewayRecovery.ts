import "server-only"

import { decodeRetainedGatewayEvidence, RetainedGatewayEvidenceError, type RetainedGatewayEvidence } from "./retainedGatewayEvidence"
import { ingestStripeFinancialAdjustment, StripeFinancialAdjustmentError, type StripeFinancialAdjustmentDependencies } from "./stripeFinancialAdjustments"
import { ingestVerifiedPayPalEvent, parsePayPalWebhookHeaders, PayPalWebhookError, type PayPalWebhookDependencies } from "./paypalWebhook"
import { validateServerIntentStripeEventEnvelope, ServerIntentStripeWebhookError } from "./stripeWebhook"

export type GatewayRecoveryCode = "invalid_request" | "not_found" | "conflict" | "not_quarantined" |
  "unavailable" | "expired" | "incomplete" | "invalid" | "unsupported" | "not_admitted" | "outcome_unknown"
export class GatewayRecoveryError extends Error {
  constructor(readonly code: GatewayRecoveryCode) {
    super("Payment event recovery could not be confirmed")
    this.name = "GatewayRecoveryError"
  }
}
export interface GatewayRecoveryDependencies {
  read(eventId: string, operationId: string): Promise<unknown>
  stripe(region: "us" | "uk"): { dependencies: StripeFinancialAdjustmentDependencies; livemode: boolean }
  paypal(): { dependencies: PayPalWebhookDependencies; apiUrl: string }
  now(): Date
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function isGatewayRecoveryIdentity(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value)
}
const ADMITTED_STATES = ["received", "processing", "processed", "failed", "ignored"]
function fail(code: GatewayRecoveryCode): never { throw new GatewayRecoveryError(code) }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("outcome_unknown")
  return value as Record<string, unknown>
}
function text(record: Record<string, unknown>, key: string, maximum = 4096): string {
  const value = record[key]
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) return fail("invalid")
  return value
}
function admitted(status: unknown, replay: boolean) {
  if (typeof status !== "string" || !ADMITTED_STATES.includes(status)) return fail("outcome_unknown")
  return { admitted: true as const, processingStatus: status, replay }
}

/** Bounded operator admission. Financial settlement remains the existing worker's responsibility. */
export async function recoverPaymentGatewayEvent(
  eventId: string,
  operationId: string,
  requestId: string,
  dependencies: GatewayRecoveryDependencies,
) {
  if (!isGatewayRecoveryIdentity(eventId) || !isGatewayRecoveryIdentity(operationId)) return fail("invalid_request")
  const deadline = dependencies.now().getTime() + 90_000
  if (!Number.isFinite(deadline)) return fail("outcome_unknown")
  const beforeWrite = () => {
    const now = dependencies.now().getTime()
    if (!Number.isFinite(now) || now >= deadline) fail("outcome_unknown")
  }
  let unsupported = false
  const forbid = async (): Promise<never> => { unsupported = true; return fail("unsupported") }
  try {
    const snapshot = object(await dependencies.read(eventId, operationId))
    if (snapshot.state === "admitted") return admitted(snapshot.processing_status, true)
    if (typeof snapshot.state === "string" && ["not_found", "conflict", "not_quarantined"].includes(snapshot.state)) {
      return fail(snapshot.state as GatewayRecoveryCode)
    }
    if (snapshot.state !== "quarantined") return fail("outcome_unknown")
    const source = object(snapshot.evidence)
    for (const key of ["provider", "providerAccountScope", "providerEventId", "eventType", "verificationMethod",
      "signatureVerifiedAt", "payloadRetentionExpiresAt", "payloadSha256", "deliveryPayloadSha256"]) text(source, key)
    if (source.payloadCiphertext !== null) text(source, "payloadCiphertext", 2 + 2 * 1048576)
    const evidence = source as unknown as RetainedGatewayEvidence
    const proof = object(source.redactedPayload)
    const context = { requestId, traceId: null, clientIp: null, userAgent: null }
    const bind = <T extends { signatureVerifiedAt: string }>(input: T) => {
      beforeWrite()
      // This is original retained authentication, never a newly verified signature.
      return { ...input, signatureVerifiedAt: evidence.signatureVerifiedAt, revalidationOperationId: operationId }
    }
    let result: { gatewayEventId: string; processingStatus: string }
    if (source.provider === "STRIPE" && ["stripe_us", "stripe_uk"].includes(source.providerAccountScope as string)) {
      const region = source.providerAccountScope === "stripe_us" ? "us" : "uk"
      const configured = dependencies.stripe(region)
      const base = configured.dependencies
      const decoded = decodeRetainedGatewayEvidence(evidence,
        { providerAccountScope: region === "us" ? "stripe_us" : "stripe_uk", stripeLivemode: configured.livemode },
        base.crypto, dependencies.now())
      if (decoded.provider !== "STRIPE") return fail("invalid")
      validateServerIntentStripeEventEnvelope(decoded.event, configured.livemode)
      const secretVersion = proof.webhook_secret_version
      if (secretVersion !== "current" && secretVersion !== "previous" && secretVersion !== null) return fail("invalid")
      const output = await ingestStripeFinancialAdjustment({ ...decoded, region,
        requestContext: { ...context, signatureHeader: proof.stripe_signature === null ? null : text(proof, "stripe_signature"),
          webhookSecretVersion: secretVersion } }, {
        ...base,
        ingestVerifiedAdjustment: input => base.ingestVerifiedAdjustment(bind(input)),
        ingestVerifiedNoEffectRefund: forbid,
        recordVerifiedCashMovement: input => {
          beforeWrite()
          return base.recordVerifiedCashMovement({ ...input, signatureVerifiedAt: evidence.signatureVerifiedAt })
        },
      })
      if (!output.handled || !output.ingested) return fail("unsupported")
      result = output
    } else if (source.provider === "PAYPAL" && source.providerAccountScope === "paypal") {
      const configured = dependencies.paypal()
      const base = configured.dependencies
      const decoded = decodeRetainedGatewayEvidence(evidence, { providerAccountScope: "paypal" }, base.crypto, dependencies.now())
      if (decoded.provider !== "PAYPAL") return fail("invalid")
      const headers = parsePayPalWebhookHeaders(new Headers({
        "paypal-transmission-id": text(proof, "paypal_transmission_id"),
        "paypal-transmission-time": text(proof, "paypal_transmission_time"),
        "paypal-transmission-sig": text(proof, "paypal_transmission_signature"),
        "paypal-cert-url": text(proof, "paypal_cert_url"),
        "paypal-auth-algo": text(proof, "paypal_auth_algorithm"),
      }), configured.apiUrl)
      const output = await ingestVerifiedPayPalEvent({ ...decoded,
        requestContext: { ...context, headers, verificationResponseSha256: text(proof, "paypal_verification_response_sha256", 64) } }, {
        ...base, verifyWebhookSignature: forbid, ingestVerifiedEvent: forbid, quarantineVerifiedEvent: forbid,
        ingestVerifiedNoEffect: forbid, ingestVerifiedAdjustment: input => base.ingestVerifiedAdjustment(bind(input)),
      })
      if (output.kind !== "adjustment") return fail("unsupported")
      result = output
    } else return fail("invalid")
    if (result.gatewayEventId !== eventId) return fail("outcome_unknown")
    return admitted(result.processingStatus, false)
  } catch (error) {
    if (unsupported) return fail("unsupported")
    if (error instanceof GatewayRecoveryError) throw error
    if (error instanceof RetainedGatewayEvidenceError) return fail(error.code)
    if ((error instanceof StripeFinancialAdjustmentError || error instanceof PayPalWebhookError ||
         error instanceof ServerIntentStripeWebhookError) && !error.retryable) return fail("not_admitted")
    return fail("outcome_unknown")
  }
}
