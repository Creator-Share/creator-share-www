import "server-only"

import {
  fromSupabaseRpcBytea,
  SPONSOR_EMAIL_NORMALIZATION_VERSION,
  SPONSORSHIP_CRYPTO_KEY_VERSION,
  type SponsorshipCrypto,
  type SupabaseRpcBytea,
} from "@/lib/sponsorships/crypto"
import {
  openSponsorWelcomeSecretMaterial,
  parseSponsorWelcomeTemplateData,
} from "@/lib/sponsorships/email/sponsorWelcomeEmailEnvelope"
import { sponsorWelcomeMessageId } from "@/lib/sponsorships/email/sponsorWelcomeEmailMessageId"
import { renderSponsorWelcomeEmail } from "@/lib/sponsorships/email/sponsorWelcomeEmailRenderer"

export interface ClaimedSponsorWelcomeEmail {
  outboxId: string
  leaseToken: string
  leaseExpiresAt: string
  kind: "sponsor_welcome"
  templateKey: "sponsor-welcome-v1"
  templateData: Record<string, unknown>
  recipientEmailCiphertext: SupabaseRpcBytea
  secretPayloadCiphertext: SupabaseRpcBytea
  emailNormalizationVersion: number
  emailHmacKeyVersion: number
  emailEncryptionKeyVersion: number
}

export interface SponsorWelcomeEmailWorkerContext {
  requestId: string
  traceId: string | null
}

export interface SponsorWelcomeEmailRepository {
  claimJobs(options: {
    workerId: string
    batchSize: number
  }): Promise<ClaimedSponsorWelcomeEmail[]>
  verifyDeliveryMaterial(options: {
    job: ClaimedSponsorWelcomeEmail
    recipientEmailHmac: SupabaseRpcBytea
    claimTokenDigest: SupabaseRpcBytea
    context: SponsorWelcomeEmailWorkerContext
  }): Promise<void>
  beginDeliveryHandoff(options: {
    job: ClaimedSponsorWelcomeEmail
    recipientEmailHmac: SupabaseRpcBytea
    providerMessageId: string
    context: SponsorWelcomeEmailWorkerContext
  }): Promise<void>
  completeDelivery(options: {
    job: ClaimedSponsorWelcomeEmail
    recipientEmailHmac: SupabaseRpcBytea
    providerMessageId: string
  }): Promise<void>
  failDelivery(options: {
    job: ClaimedSponsorWelcomeEmail
    errorSummary: string
    retryAfterSeconds: number
  }): Promise<{ retryable: boolean }>
}

export interface SponsorWelcomeEmailTransport {
  send(message: {
    outboxId: string
    providerMessageId: string
    recipientEmail: string
    subject: string
    text: string
    html: string
  }): Promise<{ providerMessageId: string }>
}

export class SponsorWelcomeEmailRepositoryError extends Error {
  readonly leaseLost: boolean
  readonly materialInvalid: boolean

  constructor(
    stage: string,
    options: { leaseLost?: boolean; materialInvalid?: boolean } = {},
  ) {
    super(`sponsor_welcome_email_repository_${stage}`)
    this.name = "SponsorWelcomeEmailRepositoryError"
    this.leaseLost = options.leaseLost === true
    this.materialInvalid = options.materialInvalid === true
  }
}

export class SponsorWelcomeEmailTransportError extends Error {
  constructor() {
    super("sponsor_welcome_email_transport_failed")
    this.name = "SponsorWelcomeEmailTransportError"
  }
}

export type SponsorWelcomeEmailProcessStatus =
  | "sent"
  | "retried"
  | "terminal_failed"
  | "lease_lost"
  | "manual_review"
  | "settlement_unknown"

export interface SponsorWelcomeEmailProcessResult {
  outboxId: string
  status: SponsorWelcomeEmailProcessStatus
  code?: string
}

export interface SponsorWelcomeEmailBatchResult {
  claimed: number
  sent: number
  retried: number
  terminalFailed: number
  leaseLost: number
  manualReview: number
  settlementUnknown: number
  results: SponsorWelcomeEmailProcessResult[]
}

export interface SponsorWelcomeEmailWorkerConfig {
  batchSize: number
  concurrency: number
  retryAfterSeconds: number
  transportTimeoutMilliseconds: number
  invocationSafetyMarginMilliseconds: number
}

export interface SponsorWelcomeEmailWorkerDependencies {
  repository: SponsorWelcomeEmailRepository
  transport: SponsorWelcomeEmailTransport
  crypto: SponsorshipCrypto
  canonicalOrigin: string
  invocationDeadlineAt?: number
  now?: () => number
}

const MATERIAL_FAILURE = "welcome_email_material_invalid"
const DELIVERY_FAILURE = "welcome_email_delivery_failed"
const INVOCATION_DEADLINE_FAILURE =
  "welcome_email_invocation_deadline_insufficient"
const REPOSITORY_FAILURE = "welcome_email_repository_failed"

class SponsorWelcomeEmailInvocationDeadlineError extends Error {
  constructor() {
    super(INVOCATION_DEADLINE_FAILURE)
    this.name = "SponsorWelcomeEmailInvocationDeadlineError"
  }
}

function staticFailureCode(error: unknown): string {
  if (error instanceof SponsorWelcomeEmailTransportError) {
    return DELIVERY_FAILURE
  }
  if (error instanceof SponsorWelcomeEmailInvocationDeadlineError) {
    return INVOCATION_DEADLINE_FAILURE
  }
  if (
    error instanceof SponsorWelcomeEmailRepositoryError &&
    !error.materialInvalid
  ) {
    return REPOSITORY_FAILURE
  }
  return MATERIAL_FAILURE
}

async function settlePreSendFailure(options: {
  repository: SponsorWelcomeEmailRepository
  job: ClaimedSponsorWelcomeEmail
  retryAfterSeconds: number
  errorSummary: string
}): Promise<SponsorWelcomeEmailProcessResult> {
  try {
    const failed = await options.repository.failDelivery({
      job: options.job,
      errorSummary: options.errorSummary,
      retryAfterSeconds: options.retryAfterSeconds,
    })
    return {
      outboxId: options.job.outboxId,
      status: failed.retryable ? "retried" : "terminal_failed",
      code: options.errorSummary,
    }
  } catch (error) {
    if (
      error instanceof SponsorWelcomeEmailRepositoryError &&
      error.leaseLost
    ) {
      return {
        outboxId: options.job.outboxId,
        status: "lease_lost",
        code: options.errorSummary,
      }
    }
    return {
      outboxId: options.job.outboxId,
      status: "settlement_unknown",
      code: options.errorSummary,
    }
  }
}

function assertClaimedEnvelope(job: ClaimedSponsorWelcomeEmail): void {
  if (
    job.kind !== "sponsor_welcome" ||
    job.templateKey !== "sponsor-welcome-v1" ||
    job.emailNormalizationVersion !== SPONSOR_EMAIL_NORMALIZATION_VERSION ||
    job.emailHmacKeyVersion !== SPONSORSHIP_CRYPTO_KEY_VERSION ||
    job.emailEncryptionKeyVersion !== SPONSORSHIP_CRYPTO_KEY_VERSION ||
    !Number.isFinite(Date.parse(job.leaseExpiresAt))
  ) {
    throw new Error(MATERIAL_FAILURE)
  }
}

function assertSendHeadroom(
  job: ClaimedSponsorWelcomeEmail,
  now: () => number,
  invocationDeadlineAt: number,
  transportTimeoutMilliseconds: number,
  invocationSafetyMarginMilliseconds: number,
): void {
  const currentTime = now()
  const requiredHeadroom =
    transportTimeoutMilliseconds + invocationSafetyMarginMilliseconds
  if (Date.parse(job.leaseExpiresAt) <= currentTime + requiredHeadroom) {
    throw new SponsorWelcomeEmailRepositoryError("send_headroom", {
      leaseLost: true,
    })
  }
  if (invocationDeadlineAt <= currentTime + requiredHeadroom) {
    throw new SponsorWelcomeEmailInvocationDeadlineError()
  }
}

export async function processSponsorWelcomeEmail(options: {
  dependencies: SponsorWelcomeEmailWorkerDependencies
  job: ClaimedSponsorWelcomeEmail
  retryAfterSeconds: number
  transportTimeoutMilliseconds?: number
  invocationSafetyMarginMilliseconds?: number
  context: SponsorWelcomeEmailWorkerContext
}): Promise<SponsorWelcomeEmailProcessResult> {
  const { dependencies, job, context } = options
  let handoffAttempted = false
  const now = dependencies.now ?? Date.now
  const transportTimeoutMilliseconds =
    options.transportTimeoutMilliseconds ?? 20_000
  const invocationSafetyMarginMilliseconds =
    options.invocationSafetyMarginMilliseconds ?? 5_000
  const invocationDeadlineAt = dependencies.invocationDeadlineAt ?? Infinity

  try {
    assertClaimedEnvelope(job)
    assertSendHeadroom(
      job,
      now,
      invocationDeadlineAt,
      transportTimeoutMilliseconds,
      invocationSafetyMarginMilliseconds,
    )
    parseSponsorWelcomeTemplateData(job.templateData)

    const recipientEmail = dependencies.crypto.decryptRecipientEmail(
      fromSupabaseRpcBytea(job.recipientEmailCiphertext),
    )
    const secretPlaintext = dependencies.crypto.decryptSecretPayload(
      fromSupabaseRpcBytea(job.secretPayloadCiphertext),
    )

    let secret
    try {
      secret = openSponsorWelcomeSecretMaterial(
        secretPlaintext,
        dependencies.crypto,
      )
    } finally {
      secretPlaintext.fill(0)
    }

    const recipientEmailHmac =
      dependencies.crypto.digestEmail(recipientEmail).digestRpcBytea
    const rendered = renderSponsorWelcomeEmail({
      canonicalOrigin: dependencies.canonicalOrigin,
      recipientEmail,
      claimToken: secret.claimToken,
      crypto: dependencies.crypto,
    })

    await dependencies.repository.verifyDeliveryMaterial({
      job,
      recipientEmailHmac,
      claimTokenDigest: secret.claimTokenDigest,
      context,
    })

    // Verification may wait on database locks. Do not persist an SMTP handoff
    // unless both the lease and this invocation can contain the transport.
    assertSendHeadroom(
      job,
      now,
      invocationDeadlineAt,
      transportTimeoutMilliseconds,
      invocationSafetyMarginMilliseconds,
    )
    const providerMessageId = sponsorWelcomeMessageId(job.outboxId)
    handoffAttempted = true
    await dependencies.repository.beginDeliveryHandoff({
      job,
      recipientEmailHmac,
      providerMessageId,
      context,
    })
    const accepted = await dependencies.transport.send({
      outboxId: job.outboxId,
      providerMessageId,
      recipientEmail,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    })
    if (accepted.providerMessageId !== providerMessageId) {
      throw new SponsorWelcomeEmailTransportError()
    }

    await dependencies.repository.completeDelivery({
      job,
      recipientEmailHmac,
      providerMessageId: accepted.providerMessageId,
    })
    return { outboxId: job.outboxId, status: "sent" }
  } catch (error) {
    if (
      handoffAttempted &&
      error instanceof SponsorWelcomeEmailRepositoryError &&
      error.leaseLost
    ) {
      return { outboxId: job.outboxId, status: "lease_lost" }
    }
    if (handoffAttempted) {
      return {
        outboxId: job.outboxId,
        status: "manual_review",
        code: "welcome_email_acceptance_ambiguous",
      }
    }
    if (
      error instanceof SponsorWelcomeEmailRepositoryError &&
      error.leaseLost
    ) {
      return { outboxId: job.outboxId, status: "lease_lost" }
    }
    return settlePreSendFailure({
      repository: dependencies.repository,
      job,
      retryAfterSeconds: options.retryAfterSeconds,
      errorSummary: staticFailureCode(error),
    })
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  apply: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0

  async function consume() {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await apply(values[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () =>
      consume(),
    ),
  )
  return results
}

function assertConfig(config: SponsorWelcomeEmailWorkerConfig): void {
  if (
    !Number.isInteger(config.batchSize) ||
    config.batchSize < 1 ||
    config.batchSize > 100 ||
    !Number.isInteger(config.concurrency) ||
    config.concurrency < 1 ||
    config.concurrency > 10 ||
    config.batchSize > config.concurrency ||
    !Number.isInteger(config.retryAfterSeconds) ||
    config.retryAfterSeconds < 1 ||
    config.retryAfterSeconds > 86_400 ||
    !Number.isInteger(config.transportTimeoutMilliseconds) ||
    config.transportTimeoutMilliseconds < 1_000 ||
    config.transportTimeoutMilliseconds > 45_000 ||
    !Number.isInteger(config.invocationSafetyMarginMilliseconds) ||
    config.invocationSafetyMarginMilliseconds < 1_000 ||
    config.invocationSafetyMarginMilliseconds > 15_000 ||
    config.transportTimeoutMilliseconds +
      config.invocationSafetyMarginMilliseconds >
      55_000
  ) {
    throw new Error("Invalid sponsor welcome email worker configuration")
  }
}

export async function runSponsorWelcomeEmailBatch(options: {
  dependencies: SponsorWelcomeEmailWorkerDependencies
  config: SponsorWelcomeEmailWorkerConfig
  workerId: string
  context: SponsorWelcomeEmailWorkerContext
}): Promise<SponsorWelcomeEmailBatchResult> {
  assertConfig(options.config)
  const jobs = await options.dependencies.repository.claimJobs({
    workerId: options.workerId,
    batchSize: options.config.batchSize,
  })
  const results = await mapWithConcurrency(
    jobs,
    options.config.concurrency,
    (job) =>
      processSponsorWelcomeEmail({
        dependencies: options.dependencies,
        job,
        retryAfterSeconds: options.config.retryAfterSeconds,
        transportTimeoutMilliseconds:
          options.config.transportTimeoutMilliseconds,
        invocationSafetyMarginMilliseconds:
          options.config.invocationSafetyMarginMilliseconds,
        context: options.context,
      }),
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
