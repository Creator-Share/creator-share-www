import "server-only"

import {
  constantTimeDigestEqual,
  fromSupabaseRpcBytea,
  SPONSOR_EMAIL_NORMALIZATION_VERSION,
  SPONSORSHIP_CRYPTO_KEY_VERSION,
  SponsorshipCryptoError,
  type SponsorshipCrypto,
  type SupabaseRpcBytea,
} from "@/lib/sponsorships/crypto"

import type { AdvocateInvitationAuthProvider } from "./emailAuth"
import { AdvocateInvitationAuthProviderError } from "./emailAuth"
import {
  AdvocateInvitationEmailEnvelopeError,
  openAdvocateInvitationSecretMaterial,
  parseAdvocateInvitationEmailTemplateData,
} from "./emailEnvelope"
import { advocateInvitationMessageId } from "./emailMessageId"
import { renderAdvocateInvitationEmail } from "./emailRenderer"

export interface ClaimedAdvocateInvitationEmail {
  outboxId: string
  invitationId: string
  advocateId: string
  leaseToken: string
  leaseExpiresAt: string
  targetAuthUserId: string | null
  templateKey: "advocate_delegate_invitation_v1"
  templateData: Record<string, unknown>
  recipientEmailCiphertext: SupabaseRpcBytea
  recipientEmailHmac: SupabaseRpcBytea
  secretPayloadCiphertext: SupabaseRpcBytea
  capabilityDigest: SupabaseRpcBytea
  emailNormalizationVersion: number
  emailHmacKeyVersion: number
  emailEncryptionKeyVersion: number
  providerIdempotencyKey: string
  attemptCount: number
}

export interface AdvocateInvitationEmailWorkerContext {
  requestId: string
  traceId: string | null
}

export type AdvocateInvitationEmailFailureCode =
  | "invitation_email_material_invalid"
  | "invitation_target_unavailable"
  | "auth_link_generation_failed"
  | "email_provider_unavailable"
  | "email_delivery_rejected"
  | "internal_error"

export interface AdvocateInvitationEmailRepository {
  claimJobs(options: {
    workerId: string
    batchSize: number
    context: AdvocateInvitationEmailWorkerContext
  }): Promise<ClaimedAdvocateInvitationEmail[]>
  bindTarget(options: {
    job: ClaimedAdvocateInvitationEmail
    targetUserId: string
    verifiedRecipientEmailHmac: SupabaseRpcBytea
    verifiedCapabilityDigest: SupabaseRpcBytea
    context: AdvocateInvitationEmailWorkerContext
  }): Promise<void>
  beginDelivery(options: {
    job: ClaimedAdvocateInvitationEmail
    verifiedRecipientEmailHmac: SupabaseRpcBytea
    verifiedCapabilityDigest: SupabaseRpcBytea
    context: AdvocateInvitationEmailWorkerContext
  }): Promise<{ providerIdempotencyKey: string }>
  settleDelivery(options: {
    job: ClaimedAdvocateInvitationEmail
    outcome: "sent" | "confirmed_not_sent"
    providerMessageId: string | null
    errorCode: AdvocateInvitationEmailFailureCode | null
    retryAfterSeconds: number
    context: AdvocateInvitationEmailWorkerContext
  }): Promise<{ status: "sent" | "failed"; retryable: boolean }>
  failDelivery(options: {
    job: ClaimedAdvocateInvitationEmail
    errorCode: AdvocateInvitationEmailFailureCode
    retryAfterSeconds: number
    context: AdvocateInvitationEmailWorkerContext
  }): Promise<{ retryable: boolean }>
}

export interface AdvocateInvitationEmailTransport {
  send(message: {
    outboxId: string
    providerMessageId: string
    providerIdempotencyKey: string
    recipientEmail: string
    subject: string
    text: string
    html: string
  }): Promise<{ providerMessageId: string }>
}

export class AdvocateInvitationEmailRepositoryError extends Error {
  readonly leaseLost: boolean
  readonly targetUnavailable: boolean

  constructor(
    stage: string,
    options: { leaseLost?: boolean; targetUnavailable?: boolean } = {},
  ) {
    super(`advocate_invitation_email_repository_${stage}`)
    this.name = "AdvocateInvitationEmailRepositoryError"
    this.leaseLost = options.leaseLost === true
    this.targetUnavailable = options.targetUnavailable === true
  }
}

export class AdvocateInvitationEmailTransportError extends Error {
  readonly confirmedNotSent: boolean
  readonly failureCode: "email_provider_unavailable" | "email_delivery_rejected"

  constructor(
    options: {
      confirmedNotSent?: boolean
      failureCode?: "email_provider_unavailable" | "email_delivery_rejected"
    } = {},
  ) {
    super("advocate_invitation_email_transport_failed")
    this.name = "AdvocateInvitationEmailTransportError"
    this.confirmedNotSent = options.confirmedNotSent === true
    this.failureCode = options.failureCode ?? "email_provider_unavailable"
  }
}

export interface AdvocateInvitationEmailWorkerConfig {
  batchSize: number
  concurrency: number
  retryAfterSeconds: number
  serviceRequestTimeoutMilliseconds: number
  transportTimeoutMilliseconds: number
  invocationSafetyMarginMilliseconds: number
}

export type AdvocateInvitationEmailProcessStatus =
  | "sent"
  | "retried"
  | "terminal_failed"
  | "lease_lost"
  | "manual_review"
  | "settlement_unknown"

export interface AdvocateInvitationEmailProcessResult {
  outboxId: string
  status: AdvocateInvitationEmailProcessStatus
  code?: string
}

export interface AdvocateInvitationEmailBatchResult {
  claimed: number
  sent: number
  retried: number
  terminalFailed: number
  leaseLost: number
  manualReview: number
  settlementUnknown: number
  results: AdvocateInvitationEmailProcessResult[]
}

export interface AdvocateInvitationEmailWorkerDependencies {
  repository: AdvocateInvitationEmailRepository
  authProvider: AdvocateInvitationAuthProvider
  transport: AdvocateInvitationEmailTransport
  crypto: SponsorshipCrypto
  canonicalOrigin: string
  now?: () => number
}

class AdvocateInvitationInvocationDeadlineError extends Error {
  constructor() {
    super("advocate_invitation_email_invocation_deadline_insufficient")
    this.name = "AdvocateInvitationInvocationDeadlineError"
  }
}

function assertClaimedJob(job: ClaimedAdvocateInvitationEmail): void {
  if (
    job.templateKey !== "advocate_delegate_invitation_v1" ||
    job.emailNormalizationVersion !== SPONSOR_EMAIL_NORMALIZATION_VERSION ||
    job.emailHmacKeyVersion !== SPONSORSHIP_CRYPTO_KEY_VERSION ||
    job.emailEncryptionKeyVersion !== SPONSORSHIP_CRYPTO_KEY_VERSION ||
    !Number.isFinite(Date.parse(job.leaseExpiresAt)) ||
    job.providerIdempotencyKey !== `advocate-invitation:${job.outboxId}` ||
    !Number.isSafeInteger(job.attemptCount) ||
    job.attemptCount < 1 ||
    job.attemptCount > 8
  ) {
    throw new AdvocateInvitationEmailEnvelopeError()
  }
}

function assertHeadroom(options: {
  job: ClaimedAdvocateInvitationEmail
  now: () => number
  invocationDeadlineAt: number
  requiredMilliseconds: number
}): void {
  const currentTime = options.now()
  if (
    !Number.isSafeInteger(currentTime) ||
    Date.parse(options.job.leaseExpiresAt) <=
      currentTime + options.requiredMilliseconds
  ) {
    throw new AdvocateInvitationEmailRepositoryError("lease_headroom", {
      leaseLost: true,
    })
  }
  if (
    options.invocationDeadlineAt <=
    currentTime + options.requiredMilliseconds
  ) {
    throw new AdvocateInvitationInvocationDeadlineError()
  }
}

function preHandoffFailureCode(
  error: unknown,
): AdvocateInvitationEmailFailureCode {
  if (error instanceof AdvocateInvitationEmailEnvelopeError) {
    return "invitation_email_material_invalid"
  }
  if (error instanceof SponsorshipCryptoError) {
    return "invitation_email_material_invalid"
  }
  if (error instanceof AdvocateInvitationAuthProviderError) {
    return error.targetUnavailable
      ? "invitation_target_unavailable"
      : "auth_link_generation_failed"
  }
  if (
    error instanceof AdvocateInvitationEmailRepositoryError &&
    error.targetUnavailable
  ) {
    return "invitation_target_unavailable"
  }
  return "internal_error"
}

async function settlePreHandoffFailure(options: {
  repository: AdvocateInvitationEmailRepository
  job: ClaimedAdvocateInvitationEmail
  errorCode: AdvocateInvitationEmailFailureCode
  retryAfterSeconds: number
  context: AdvocateInvitationEmailWorkerContext
}): Promise<AdvocateInvitationEmailProcessResult> {
  try {
    const result = await options.repository.failDelivery(options)
    return {
      outboxId: options.job.outboxId,
      status: result.retryable ? "retried" : "terminal_failed",
      code: options.errorCode,
    }
  } catch (error) {
    if (
      error instanceof AdvocateInvitationEmailRepositoryError &&
      error.leaseLost
    ) {
      return {
        outboxId: options.job.outboxId,
        status: "lease_lost",
        code: options.errorCode,
      }
    }
    return {
      outboxId: options.job.outboxId,
      status: "settlement_unknown",
      code: options.errorCode,
    }
  }
}

export async function processAdvocateInvitationEmail(options: {
  dependencies: AdvocateInvitationEmailWorkerDependencies
  config: AdvocateInvitationEmailWorkerConfig
  job: ClaimedAdvocateInvitationEmail
  context: AdvocateInvitationEmailWorkerContext
  invocationDeadlineAt: number
}): Promise<AdvocateInvitationEmailProcessResult> {
  const { dependencies, config, job, context } = options
  const now = dependencies.now ?? Date.now
  let handoffAttempted = false

  try {
    assertClaimedJob(job)
    const template = parseAdvocateInvitationEmailTemplateData(job.templateData)
    if (template.invitationId !== job.invitationId) {
      throw new AdvocateInvitationEmailEnvelopeError()
    }
    assertHeadroom({
      job,
      now,
      invocationDeadlineAt: options.invocationDeadlineAt,
      requiredMilliseconds:
        config.serviceRequestTimeoutMilliseconds * 4 +
        config.transportTimeoutMilliseconds +
        config.invocationSafetyMarginMilliseconds,
    })

    const recipientEmail = dependencies.crypto.decryptRecipientEmail(
      fromSupabaseRpcBytea(job.recipientEmailCiphertext),
    )
    const secretPlaintext = dependencies.crypto.decryptSecretPayload(
      fromSupabaseRpcBytea(job.secretPayloadCiphertext),
    )
    let secret
    try {
      secret = openAdvocateInvitationSecretMaterial(secretPlaintext)
    } finally {
      secretPlaintext.fill(0)
    }
    const recipientDigest = dependencies.crypto.digestEmail(recipientEmail)
    if (
      !constantTimeDigestEqual(
        recipientDigest.digest,
        fromSupabaseRpcBytea(job.recipientEmailHmac),
      ) ||
      !constantTimeDigestEqual(
        fromSupabaseRpcBytea(secret.capabilityDigest),
        fromSupabaseRpcBytea(job.capabilityDigest),
      )
    ) {
      throw new AdvocateInvitationEmailEnvelopeError()
    }

    const authProof = await dependencies.authProvider.generateMagicLink({
      recipientEmail,
      redirectTo: `${dependencies.canonicalOrigin}/advocate-invitation`,
      createUserIfMissing: true,
    })
    if (
      job.targetAuthUserId !== null &&
      job.targetAuthUserId !== authProof.userId
    ) {
      throw new AdvocateInvitationAuthProviderError({
        targetUnavailable: true,
      })
    }
    await dependencies.repository.bindTarget({
      job,
      targetUserId: authProof.userId,
      verifiedRecipientEmailHmac: recipientDigest.digestRpcBytea,
      verifiedCapabilityDigest: secret.capabilityDigest,
      context,
    })

    assertHeadroom({
      job,
      now,
      invocationDeadlineAt: options.invocationDeadlineAt,
      requiredMilliseconds:
        config.serviceRequestTimeoutMilliseconds * 2 +
        config.transportTimeoutMilliseconds +
        config.invocationSafetyMarginMilliseconds,
    })
    const rendered = renderAdvocateInvitationEmail({
      canonicalOrigin: dependencies.canonicalOrigin,
      template,
      authTokenHash: authProof.hashedToken,
      capability: secret.capability,
    })
    const providerMessageId = advocateInvitationMessageId(job.outboxId)

    handoffAttempted = true
    const handoff = await dependencies.repository.beginDelivery({
      job,
      verifiedRecipientEmailHmac: recipientDigest.digestRpcBytea,
      verifiedCapabilityDigest: secret.capabilityDigest,
      context,
    })
    if (handoff.providerIdempotencyKey !== job.providerIdempotencyKey) {
      throw new AdvocateInvitationEmailRepositoryError("handoff_shape")
    }

    let accepted
    try {
      accepted = await dependencies.transport.send({
        outboxId: job.outboxId,
        providerMessageId,
        providerIdempotencyKey: job.providerIdempotencyKey,
        recipientEmail,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      })
    } catch (error) {
      if (
        error instanceof AdvocateInvitationEmailTransportError &&
        error.confirmedNotSent
      ) {
        try {
          const settled = await dependencies.repository.settleDelivery({
            job,
            outcome: "confirmed_not_sent",
            providerMessageId: null,
            errorCode: error.failureCode,
            retryAfterSeconds: config.retryAfterSeconds,
            context,
          })
          if (settled.status !== "failed") {
            throw new AdvocateInvitationEmailRepositoryError("settle_shape")
          }
          return {
            outboxId: job.outboxId,
            status: settled.retryable ? "retried" : "terminal_failed",
            code: error.failureCode,
          }
        } catch (settlementError) {
          if (
            settlementError instanceof AdvocateInvitationEmailRepositoryError &&
            settlementError.leaseLost
          ) {
            return { outboxId: job.outboxId, status: "lease_lost" }
          }
          return { outboxId: job.outboxId, status: "settlement_unknown" }
        }
      }
      throw error
    }
    if (accepted.providerMessageId !== providerMessageId) {
      throw new AdvocateInvitationEmailTransportError()
    }

    try {
      const settled = await dependencies.repository.settleDelivery({
        job,
        outcome: "sent",
        providerMessageId: accepted.providerMessageId,
        errorCode: null,
        retryAfterSeconds: config.retryAfterSeconds,
        context,
      })
      if (settled.status !== "sent" || settled.retryable) {
        throw new AdvocateInvitationEmailRepositoryError("settle_shape")
      }
      return { outboxId: job.outboxId, status: "sent" }
    } catch (error) {
      if (
        error instanceof AdvocateInvitationEmailRepositoryError &&
        error.leaseLost
      ) {
        return { outboxId: job.outboxId, status: "lease_lost" }
      }
      return { outboxId: job.outboxId, status: "settlement_unknown" }
    }
  } catch (error) {
    if (
      handoffAttempted &&
      error instanceof AdvocateInvitationEmailRepositoryError &&
      error.leaseLost
    ) {
      return { outboxId: job.outboxId, status: "lease_lost" }
    }
    if (handoffAttempted) {
      return {
        outboxId: job.outboxId,
        status: "manual_review",
        code: "invitation_email_acceptance_ambiguous",
      }
    }
    if (
      error instanceof AdvocateInvitationEmailRepositoryError &&
      error.leaseLost
    ) {
      return { outboxId: job.outboxId, status: "lease_lost" }
    }
    return settlePreHandoffFailure({
      repository: dependencies.repository,
      job,
      errorCode: preHandoffFailureCode(error),
      retryAfterSeconds: config.retryAfterSeconds,
      context,
    })
  }
}

function assertConfig(config: AdvocateInvitationEmailWorkerConfig): void {
  if (
    !Number.isSafeInteger(config.batchSize) ||
    config.batchSize < 1 ||
    config.batchSize > 20 ||
    !Number.isSafeInteger(config.concurrency) ||
    config.concurrency < 1 ||
    config.concurrency > 4 ||
    config.concurrency > config.batchSize ||
    !Number.isSafeInteger(config.retryAfterSeconds) ||
    config.retryAfterSeconds < 1 ||
    config.retryAfterSeconds > 86_400 ||
    !Number.isSafeInteger(config.serviceRequestTimeoutMilliseconds) ||
    config.serviceRequestTimeoutMilliseconds < 1_000 ||
    config.serviceRequestTimeoutMilliseconds > 10_000 ||
    !Number.isSafeInteger(config.transportTimeoutMilliseconds) ||
    config.transportTimeoutMilliseconds < 1_000 ||
    config.transportTimeoutMilliseconds > 30_000 ||
    !Number.isSafeInteger(config.invocationSafetyMarginMilliseconds) ||
    config.invocationSafetyMarginMilliseconds < 1_000 ||
    config.invocationSafetyMarginMilliseconds > 15_000 ||
    config.serviceRequestTimeoutMilliseconds * 5 +
      config.transportTimeoutMilliseconds +
      config.invocationSafetyMarginMilliseconds >
      59_000
  ) {
    throw new Error("Advocate invitation email worker configuration is invalid")
  }
}

export function emptyAdvocateInvitationEmailBatchResult(): AdvocateInvitationEmailBatchResult {
  return {
    claimed: 0,
    sent: 0,
    retried: 0,
    terminalFailed: 0,
    leaseLost: 0,
    manualReview: 0,
    settlementUnknown: 0,
    results: [],
  }
}

export async function runAdvocateInvitationEmailBatch(options: {
  dependencies: AdvocateInvitationEmailWorkerDependencies
  config: AdvocateInvitationEmailWorkerConfig
  workerId: string
  context: AdvocateInvitationEmailWorkerContext
  invocationDeadlineAt: number
}): Promise<AdvocateInvitationEmailBatchResult> {
  assertConfig(options.config)
  const jobs = await options.dependencies.repository.claimJobs({
    workerId: options.workerId,
    batchSize: options.config.batchSize,
    context: options.context,
  })
  if (jobs.length > options.config.batchSize) {
    throw new Error("Advocate invitation email claim exceeded its boundary")
  }

  const results = new Array<AdvocateInvitationEmailProcessResult>(jobs.length)
  let cursor = 0
  const consume = async () => {
    while (cursor < jobs.length) {
      const index = cursor
      cursor += 1
      results[index] = await processAdvocateInvitationEmail({
        dependencies: options.dependencies,
        config: options.config,
        job: jobs[index],
        context: options.context,
        invocationDeadlineAt: options.invocationDeadlineAt,
      })
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(options.config.concurrency, jobs.length) },
      consume,
    ),
  )

  return {
    claimed: results.length,
    sent: results.filter((result) => result.status === "sent").length,
    retried: results.filter((result) => result.status === "retried").length,
    terminalFailed: results.filter(
      (result) => result.status === "terminal_failed",
    ).length,
    leaseLost: results.filter((result) => result.status === "lease_lost")
      .length,
    manualReview: results.filter((result) => result.status === "manual_review")
      .length,
    settlementUnknown: results.filter(
      (result) => result.status === "settlement_unknown",
    ).length,
    results,
  }
}
