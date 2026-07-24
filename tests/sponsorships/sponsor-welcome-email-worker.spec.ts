import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  ClaimedSponsorWelcomeEmail,
  SponsorWelcomeEmailRepository,
  SponsorWelcomeEmailTransport,
} from "../../src/lib/sponsorships/email/sponsorWelcomeEmailWorker"

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
    "tests/sponsorships/sponsor-welcome-email-worker.spec.ts",
  ),
)
const { createSponsorshipCrypto, toSupabaseRpcBytea } = testRequire(
  "../../src/lib/sponsorships/crypto",
) as typeof import("../../src/lib/sponsorships/crypto")
const {
  openSponsorWelcomeSecretMaterial,
  parseSponsorWelcomeTemplateData,
  SponsorWelcomeEmailEnvelopeError,
} = testRequire(
  "../../src/lib/sponsorships/email/sponsorWelcomeEmailEnvelope",
) as typeof import("../../src/lib/sponsorships/email/sponsorWelcomeEmailEnvelope")
const { renderSponsorWelcomeEmail } = testRequire(
  "../../src/lib/sponsorships/email/sponsorWelcomeEmailRenderer",
) as typeof import("../../src/lib/sponsorships/email/sponsorWelcomeEmailRenderer")
const { isAuthorizedSponsorWelcomeEmailWorkerRequest } = testRequire(
  "../../src/lib/sponsorships/email/sponsorWelcomeEmailAuth",
) as typeof import("../../src/lib/sponsorships/email/sponsorWelcomeEmailAuth")
const {
  loadSponsorWelcomeEmailCanonicalOrigin,
  loadSponsorWelcomeEmailTransportConfig,
  loadSponsorWelcomeEmailWorkerConfig,
  loadSponsorWelcomeEmailWorkerSecret,
} = testRequire(
  "../../src/lib/sponsorships/email/sponsorWelcomeEmailConfig",
) as typeof import("../../src/lib/sponsorships/email/sponsorWelcomeEmailConfig")
const { createSupabaseSponsorWelcomeEmailRepository } = testRequire(
  "../../src/lib/sponsorships/email/sponsorWelcomeEmailRepository",
) as typeof import("../../src/lib/sponsorships/email/sponsorWelcomeEmailRepository")
const {
  createNodemailerSponsorWelcomeEmailTransport,
  sponsorWelcomeMessageId,
} = testRequire(
  "../../src/lib/sponsorships/email/sponsorWelcomeEmailTransport",
) as typeof import("../../src/lib/sponsorships/email/sponsorWelcomeEmailTransport")
const {
  processSponsorWelcomeEmail,
  runSponsorWelcomeEmailBatch,
  SponsorWelcomeEmailRepositoryError,
  SponsorWelcomeEmailTransportError,
} = testRequire(
  "../../src/lib/sponsorships/email/sponsorWelcomeEmailWorker",
) as typeof import("../../src/lib/sponsorships/email/sponsorWelcomeEmailWorker")
nodeModule._load = originalModuleLoad

const APP_SECRET = Buffer.alloc(32, 23).toString("base64")
const OUTBOX_ID = "11111111-1111-4111-8111-111111111111"
const CLAIM_ID = "22222222-2222-4222-8222-222222222222"
const BENEFICIARY_ID = "33333333-3333-4333-8333-333333333333"
const LEASE_TOKEN = "a1".repeat(32)
const CLAIM_TOKEN = Buffer.alloc(32, 17).toString("base64url")
const RECIPIENT = "sponsor@example.test"
const PROVIDER_MESSAGE_ID = `<sponsor-welcome.${OUTBOX_ID}@creatorshare.com>`
const context = { requestId: "request-reference", traceId: "trace-reference" }

const crypto = createSponsorshipCrypto({ appSecretBase64: APP_SECRET })

function claimedJob(
  overrides: Partial<ClaimedSponsorWelcomeEmail> = {},
): ClaimedSponsorWelcomeEmail {
  const recipient = crypto.encryptRecipientEmail(RECIPIENT)
  const secret = crypto.encryptSecretPayload(
    JSON.stringify({ version: 1, claimToken: CLAIM_TOKEN }),
  )
  return {
    outboxId: OUTBOX_ID,
    leaseToken: LEASE_TOKEN,
    leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    kind: "sponsor_welcome",
    templateKey: "sponsor-welcome-v1",
    templateData: {
      subject_kind: "standard",
      beneficiary_id: BENEFICIARY_ID,
      payment_mode: "recurring",
      recurrence_interval: "month",
      locale: "en-US",
    },
    recipientEmailCiphertext: recipient.ciphertextRpcBytea,
    secretPayloadCiphertext: secret.ciphertextRpcBytea,
    emailNormalizationVersion: 1,
    emailHmacKeyVersion: 1,
    emailEncryptionKeyVersion: 1,
    ...overrides,
  }
}

function repository(
  overrides: Partial<SponsorWelcomeEmailRepository> = {},
): SponsorWelcomeEmailRepository {
  return {
    async claimJobs() {
      return []
    },
    async verifyDeliveryMaterial() {},
    async beginDeliveryHandoff() {},
    async completeDelivery() {},
    async failDelivery() {
      return { retryable: true }
    },
    ...overrides,
  }
}

const acceptingTransport: SponsorWelcomeEmailTransport = {
  async send(message) {
    return { providerMessageId: message.providerMessageId }
  },
}

test.describe("sponsor welcome delivery worker", () => {
  test("verifies decrypted material before provider acceptance and completion", async () => {
    const stages: string[] = []
    let verifiedEmailHmac: string | null = null
    let verifiedClaimDigest: string | null = null
    const job = claimedJob()
    const result = await processSponsorWelcomeEmail({
      job,
      retryAfterSeconds: 300,
      context,
      dependencies: {
        crypto,
        canonicalOrigin: "https://creatorshare.com",
        repository: repository({
          async verifyDeliveryMaterial(options) {
            stages.push("verify")
            verifiedEmailHmac = options.recipientEmailHmac
            verifiedClaimDigest = options.claimTokenDigest
          },
          async beginDeliveryHandoff(options) {
            stages.push("handoff")
            expect(options.providerMessageId).toBe(PROVIDER_MESSAGE_ID)
          },
          async completeDelivery(options) {
            stages.push("complete")
            expect(options.providerMessageId).toBe(PROVIDER_MESSAGE_ID)
          },
        }),
        transport: {
          async send(message) {
            stages.push("send")
            expect(message.subject).toBe("Welcome to the Creator Share family")
            expect(message.text).toContain("#token=")
            return { providerMessageId: PROVIDER_MESSAGE_ID }
          },
        },
      },
    })

    expect(result).toEqual({ outboxId: OUTBOX_ID, status: "sent" })
    expect(stages).toEqual(["verify", "handoff", "send", "complete"])
    expect(verifiedEmailHmac).toBe(crypto.digestEmail(RECIPIENT).digestRpcBytea)
    expect(verifiedClaimDigest).toBe(
      toSupabaseRpcBytea(crypto.digestOpaqueToken(CLAIM_TOKEN)),
    )
  })

  test("terminalizes a nonexact secret envelope before verification or send", async () => {
    const badSecret = crypto.encryptSecretPayload(
      JSON.stringify({ version: 1, claimToken: CLAIM_TOKEN, extra: true }),
    )
    let verified = false
    let sent = false
    let failureCode: string | null = null
    const result = await processSponsorWelcomeEmail({
      job: claimedJob({
        secretPayloadCiphertext: badSecret.ciphertextRpcBytea,
      }),
      retryAfterSeconds: 300,
      context,
      dependencies: {
        crypto,
        canonicalOrigin: "https://creatorshare.com",
        repository: repository({
          async verifyDeliveryMaterial() {
            verified = true
          },
          async failDelivery(options) {
            failureCode = options.errorSummary
            return { retryable: false }
          },
        }),
        transport: {
          async send() {
            sent = true
            return { providerMessageId: PROVIDER_MESSAGE_ID }
          },
        },
      },
    })

    expect(result.status).toBe("terminal_failed")
    expect(failureCode).toBe("welcome_email_material_invalid")
    expect(verified).toBe(false)
    expect(sent).toBe(false)
  })

  test("rejects a staging-disallowed recipient before verification or handoff", async () => {
    const stages: string[] = []
    let failureCode: string | null = null
    const result = await processSponsorWelcomeEmail({
      job: claimedJob(),
      retryAfterSeconds: 300,
      context,
      dependencies: {
        crypto,
        canonicalOrigin: "https://advocate-staging.creatorshare.com",
        assertRecipientAllowed() {
          stages.push("recipient-policy")
          throw new Error("staging recipient rejected")
        },
        repository: repository({
          async verifyDeliveryMaterial() {
            stages.push("verify")
          },
          async beginDeliveryHandoff() {
            stages.push("handoff")
          },
          async failDelivery(options) {
            stages.push("fail")
            failureCode = options.errorSummary
            return { retryable: false }
          },
        }),
        transport: {
          async send() {
            stages.push("send")
            throw new Error("must not send")
          },
        },
      },
    })

    expect(result.status).toBe("terminal_failed")
    expect(failureCode).toBe("welcome_email_material_invalid")
    expect(stages).toEqual(["recipient-policy", "fail"])
  })

  test("quarantines a provider failure after the durable SMTP handoff", async () => {
    let failed = false
    const result = await processSponsorWelcomeEmail({
      job: claimedJob(),
      retryAfterSeconds: 420,
      context,
      dependencies: {
        crypto,
        canonicalOrigin: "https://creatorshare.com",
        repository: repository({
          async failDelivery() {
            failed = true
            return { retryable: true }
          },
        }),
        transport: {
          async send() {
            throw new SponsorWelcomeEmailTransportError()
          },
        },
      },
    })

    expect(result).toEqual({
      outboxId: OUTBOX_ID,
      status: "manual_review",
      code: "welcome_email_acceptance_ambiguous",
    })
    expect(failed).toBe(false)
  })

  test("does not fail a lease after provider acceptance when completion is unknown", async () => {
    let failed = false
    const result = await processSponsorWelcomeEmail({
      job: claimedJob(),
      retryAfterSeconds: 300,
      context,
      dependencies: {
        crypto,
        canonicalOrigin: "https://creatorshare.com",
        repository: repository({
          async completeDelivery() {
            throw new SponsorWelcomeEmailRepositoryError("complete")
          },
          async failDelivery() {
            failed = true
            return { retryable: true }
          },
        }),
        transport: acceptingTransport,
      },
    })

    expect(result.status).toBe("manual_review")
    expect(failed).toBe(false)
  })

  test("does not send or fail after a material verification lease loss", async () => {
    let sent = false
    let failed = false
    const result = await processSponsorWelcomeEmail({
      job: claimedJob(),
      retryAfterSeconds: 300,
      context,
      dependencies: {
        crypto,
        canonicalOrigin: "https://creatorshare.com",
        repository: repository({
          async verifyDeliveryMaterial() {
            throw new SponsorWelcomeEmailRepositoryError("verify", {
              leaseLost: true,
            })
          },
          async failDelivery() {
            failed = true
            return { retryable: true }
          },
        }),
        transport: {
          async send() {
            sent = true
            return { providerMessageId: PROVIDER_MESSAGE_ID }
          },
        },
      },
    })

    expect(result.status).toBe("lease_lost")
    expect(sent).toBe(false)
    expect(failed).toBe(false)
  })

  test("terminalizes a durable material mismatch SQLSTATE", async () => {
    let failureCode: string | null = null
    const result = await processSponsorWelcomeEmail({
      job: claimedJob(),
      retryAfterSeconds: 300,
      context,
      dependencies: {
        crypto,
        canonicalOrigin: "https://creatorshare.com",
        repository: repository({
          async verifyDeliveryMaterial() {
            throw new SponsorWelcomeEmailRepositoryError("verify", {
              materialInvalid: true,
            })
          },
          async failDelivery(options) {
            failureCode = options.errorSummary
            return { retryable: false }
          },
        }),
        transport: acceptingTransport,
      },
    })

    expect(result.status).toBe("terminal_failed")
    expect(failureCode).toBe("welcome_email_material_invalid")
  })

  test("rechecks lease headroom immediately before SMTP handoff", async () => {
    let nowCall = 0
    let sent = false
    let failed = false
    const leaseExpiresAt = new Date(200_000).toISOString()
    const result = await processSponsorWelcomeEmail({
      job: claimedJob({ leaseExpiresAt }),
      retryAfterSeconds: 300,
      context,
      dependencies: {
        crypto,
        canonicalOrigin: "https://creatorshare.com",
        now() {
          nowCall += 1
          return nowCall === 1 ? 0 : 180_000
        },
        repository: repository({
          async failDelivery() {
            failed = true
            return { retryable: true }
          },
        }),
        transport: {
          async send() {
            sent = true
            return { providerMessageId: PROVIDER_MESSAGE_ID }
          },
        },
      },
    })

    expect(result.status).toBe("lease_lost")
    expect(nowCall).toBe(2)
    expect(sent).toBe(false)
    expect(failed).toBe(false)
  })

  test("durably retries before SMTP when invocation time is insufficient", async () => {
    let handedOff = false
    let sent = false
    let failureCode: string | null = null
    const result = await processSponsorWelcomeEmail({
      job: claimedJob(),
      retryAfterSeconds: 300,
      transportTimeoutMilliseconds: 20_000,
      invocationSafetyMarginMilliseconds: 5_000,
      context,
      dependencies: {
        crypto,
        canonicalOrigin: "https://creatorshare.com",
        invocationDeadlineAt: 120_000,
        now: (() => {
          let call = 0
          return () => {
            call += 1
            return call === 1 ? 0 : 100_000
          }
        })(),
        repository: repository({
          async beginDeliveryHandoff() {
            handedOff = true
          },
          async failDelivery(options) {
            failureCode = options.errorSummary
            return { retryable: true }
          },
        }),
        transport: {
          async send() {
            sent = true
            return { providerMessageId: PROVIDER_MESSAGE_ID }
          },
        },
      },
    })

    expect(result.status).toBe("retried")
    expect(failureCode).toBe("welcome_email_invocation_deadline_insufficient")
    expect(handedOff).toBe(false)
    expect(sent).toBe(false)
  })

  test("honors configured batch size and concurrency", async () => {
    let requestedBatchSize = 0
    let active = 0
    let maximumActive = 0
    const jobs = [
      claimedJob(),
      claimedJob({
        outboxId: "44444444-4444-4444-8444-444444444444",
      }),
      claimedJob({
        outboxId: "55555555-5555-4555-8555-555555555555",
      }),
    ]
    const batch = await runSponsorWelcomeEmailBatch({
      workerId: "welcome-worker",
      context,
      config: {
        batchSize: 3,
        concurrency: 3,
        retryAfterSeconds: 300,
        transportTimeoutMilliseconds: 20_000,
        invocationSafetyMarginMilliseconds: 5_000,
      },
      dependencies: {
        crypto,
        canonicalOrigin: "https://creatorshare.com",
        repository: repository({
          async claimJobs(options) {
            requestedBatchSize = options.batchSize
            return jobs
          },
          async verifyDeliveryMaterial() {
            active += 1
            maximumActive = Math.max(maximumActive, active)
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 5))
          },
          async completeDelivery() {
            active -= 1
          },
        }),
        transport: acceptingTransport,
      },
    })

    expect(requestedBatchSize).toBe(3)
    expect(maximumActive).toBe(3)
    expect(batch).toMatchObject({ claimed: 3, sent: 3 })
  })

  test("rejects a batch that would require multiple SMTP waves", async () => {
    await expect(
      runSponsorWelcomeEmailBatch({
        workerId: "welcome-worker",
        context,
        config: {
          batchSize: 2,
          concurrency: 1,
          retryAfterSeconds: 300,
          transportTimeoutMilliseconds: 20_000,
          invocationSafetyMarginMilliseconds: 5_000,
        },
        dependencies: {
          crypto,
          canonicalOrigin: "https://creatorshare.com",
          repository: repository(),
          transport: acceptingTransport,
        },
      }),
    ).rejects.toThrow("Invalid sponsor welcome email worker configuration")
  })
})

test.describe("sponsor welcome envelope and renderer", () => {
  test("accepts the exact supported template shape and rejects extra fields", () => {
    expect(
      parseSponsorWelcomeTemplateData({
        subject_kind: "blind",
        payment_mode: "one_time",
      }),
    ).toMatchObject({
      subjectKind: "blind",
      paymentMode: "one_time",
    })
    expect(() =>
      parseSponsorWelcomeTemplateData({
        subject_kind: "blind",
        payment_mode: "one_time",
        display_name: "unsupported",
      }),
    ).toThrow(SponsorWelcomeEmailEnvelopeError)
    expect(() =>
      parseSponsorWelcomeTemplateData({
        subject_kind: "partnership",
        partnership_project: "education",
        payment_mode: "one_time",
      }),
    ).toThrow(SponsorWelcomeEmailEnvelopeError)
  })

  test("opens only the versioned two-field claim envelope", () => {
    const opened = openSponsorWelcomeSecretMaterial(
      Buffer.from(JSON.stringify({ version: 1, claimToken: CLAIM_TOKEN })),
      crypto,
    )
    expect(opened.claimTokenDigest).toBe(
      toSupabaseRpcBytea(crypto.digestOpaqueToken(CLAIM_TOKEN)),
    )
    expect(() =>
      openSponsorWelcomeSecretMaterial(
        Buffer.from(
          JSON.stringify({ version: 1, claimToken: CLAIM_TOKEN, scope: "all" }),
        ),
        crypto,
      ),
    ).toThrow(SponsorWelcomeEmailEnvelopeError)
  })

  test("renders one fixed brand template with a fragment claim URL", () => {
    const rendered = renderSponsorWelcomeEmail({
      canonicalOrigin: "https://creatorshare.com",
      recipientEmail: RECIPIENT,
      claimToken: CLAIM_TOKEN,
      crypto,
    })
    const parsed = new URL(rendered.claimUrl)

    expect(parsed.origin).toBe("https://creatorshare.com")
    expect(parsed.pathname).toBe("/sponsor/claim")
    expect(parsed.search).toBe("")
    expect(parsed.hash).toContain("token=")
    expect(parsed.hash).toContain("email=")
    expect(rendered.html).toContain("Creator Share")
    expect(rendered.html).not.toContain("<img")
    expect(rendered.html).not.toContain("utm_")
    expect(rendered.html).not.toContain("advocate")
  })
})

test.describe("sponsor welcome repository boundary", () => {
  test("parses claimed rows and sends only digests into proof RPCs", async () => {
    const job = claimedJob()
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args })
        if (name === "claim_email_outbox_jobs") {
          return {
            data: [
              {
                outbox_id: job.outboxId,
                lease_token: job.leaseToken,
                lease_expires_at: job.leaseExpiresAt,
                kind: job.kind,
                template_key: job.templateKey,
                template_data: job.templateData,
                recipient_email_ciphertext: job.recipientEmailCiphertext,
                secret_payload_ciphertext: job.secretPayloadCiphertext,
                email_normalization_version: 1,
                email_hmac_key_version: 1,
                email_encryption_key_version: 1,
              },
            ],
            error: null,
          }
        }
        if (name === "verify_email_outbox_delivery_material") {
          return {
            data: [
              {
                outbox_id: OUTBOX_ID,
                account_claim_id: CLAIM_ID,
                verified: true,
              },
            ],
            error: null,
          }
        }
        if (name === "complete_email_outbox_delivery") {
          return { data: "2026-07-18T08:00:00.000Z", error: null }
        }
        if (name === "begin_email_outbox_delivery_handoff") {
          return { data: "2026-07-18T07:59:59.000Z", error: null }
        }
        return { data: true, error: null }
      },
    } as unknown as SupabaseClient
    const boundary = createSupabaseSponsorWelcomeEmailRepository(client)
    const [claimed] = await boundary.claimJobs({
      workerId: "welcome-worker",
      batchSize: 1,
    })
    const emailHmac = crypto.digestEmail(RECIPIENT).digestRpcBytea
    const tokenDigest = toSupabaseRpcBytea(
      crypto.digestOpaqueToken(CLAIM_TOKEN),
    )

    await boundary.verifyDeliveryMaterial({
      job: claimed,
      recipientEmailHmac: emailHmac,
      claimTokenDigest: tokenDigest,
      context,
    })
    await boundary.beginDeliveryHandoff({
      job: claimed,
      recipientEmailHmac: emailHmac,
      providerMessageId: PROVIDER_MESSAGE_ID,
      context,
    })
    await boundary.completeDelivery({
      job: claimed,
      recipientEmailHmac: emailHmac,
      providerMessageId: PROVIDER_MESSAGE_ID,
    })
    await boundary.failDelivery({
      job: claimed,
      errorSummary: "welcome_email_delivery_failed",
      retryAfterSeconds: 300,
    })

    expect(claimed.outboxId).toBe(OUTBOX_ID)
    expect(calls[1].args).toMatchObject({
      target_outbox_id: OUTBOX_ID,
      verified_recipient_email_hmac: emailHmac,
      verified_claim_token_digest: tokenDigest,
    })
    expect(JSON.stringify(calls)).not.toContain(RECIPIENT)
    expect(calls[2]).toMatchObject({
      name: "begin_email_outbox_delivery_handoff",
      args: {
        target_provider_message_id: PROVIDER_MESSAGE_ID,
        verified_recipient_email_hmac: emailHmac,
      },
    })
    expect(calls[3].args.email_log_id).toBeNull()
  })

  test("rejects malformed claimed binary material with a static error", async () => {
    const job = claimedJob()
    const client = {
      async rpc() {
        return {
          data: [
            {
              outbox_id: job.outboxId,
              lease_token: job.leaseToken,
              lease_expires_at: job.leaseExpiresAt,
              kind: job.kind,
              template_key: job.templateKey,
              template_data: job.templateData,
              recipient_email_ciphertext: "not-binary",
              secret_payload_ciphertext: job.secretPayloadCiphertext,
              email_normalization_version: 1,
              email_hmac_key_version: 1,
              email_encryption_key_version: 1,
            },
          ],
          error: null,
        }
      },
    } as unknown as SupabaseClient

    await expect(
      createSupabaseSponsorWelcomeEmailRepository(client).claimJobs({
        workerId: "welcome-worker",
        batchSize: 1,
      }),
    ).rejects.toThrow("sponsor_welcome_email_repository_claim_shape")
  })

  test("rejects an over-cardinality or duplicate claim batch", async () => {
    const job = claimedJob()
    const row = {
      outbox_id: job.outboxId,
      lease_token: job.leaseToken,
      lease_expires_at: job.leaseExpiresAt,
      kind: job.kind,
      template_key: job.templateKey,
      template_data: job.templateData,
      recipient_email_ciphertext: job.recipientEmailCiphertext,
      secret_payload_ciphertext: job.secretPayloadCiphertext,
      email_normalization_version: 1,
      email_hmac_key_version: 1,
      email_encryption_key_version: 1,
    }
    const overCardinalityClient = {
      async rpc() {
        return { data: [row, { ...row, outbox_id: CLAIM_ID }], error: null }
      },
    } as unknown as SupabaseClient
    await expect(
      createSupabaseSponsorWelcomeEmailRepository(
        overCardinalityClient,
      ).claimJobs({ workerId: "welcome-worker", batchSize: 1 }),
    ).rejects.toThrow("sponsor_welcome_email_repository_claim_cardinality")

    const duplicateClient = {
      async rpc() {
        return { data: [row, row], error: null }
      },
    } as unknown as SupabaseClient
    await expect(
      createSupabaseSponsorWelcomeEmailRepository(duplicateClient).claimJobs({
        workerId: "welcome-worker",
        batchSize: 2,
      }),
    ).rejects.toThrow("sponsor_welcome_email_repository_claim_duplicate")
  })

  test("maps stale leases separately from durable material mismatches", async () => {
    const job = claimedJob()
    const claimedRow = {
      outbox_id: job.outboxId,
      lease_token: job.leaseToken,
      lease_expires_at: job.leaseExpiresAt,
      kind: job.kind,
      template_key: job.templateKey,
      template_data: job.templateData,
      recipient_email_ciphertext: job.recipientEmailCiphertext,
      secret_payload_ciphertext: job.secretPayloadCiphertext,
      email_normalization_version: 1,
      email_hmac_key_version: 1,
      email_encryption_key_version: 1,
    }

    for (const [code, expected] of [
      ["55P03", { leaseLost: true, materialInvalid: false }],
      ["23514", { leaseLost: false, materialInvalid: true }],
    ] as const) {
      const client = {
        async rpc(name: string) {
          if (name === "claim_email_outbox_jobs") {
            return { data: [claimedRow], error: null }
          }
          return { data: null, error: { code } }
        },
      } as unknown as SupabaseClient
      const boundary = createSupabaseSponsorWelcomeEmailRepository(client)
      const [claimed] = await boundary.claimJobs({
        workerId: "welcome-worker",
        batchSize: 1,
      })
      let caught: {
        leaseLost: boolean
        materialInvalid: boolean
      } | null = null
      try {
        await boundary.verifyDeliveryMaterial({
          job: claimed,
          recipientEmailHmac: crypto.digestEmail(RECIPIENT).digestRpcBytea,
          claimTokenDigest: toSupabaseRpcBytea(
            crypto.digestOpaqueToken(CLAIM_TOKEN),
          ),
          context,
        })
      } catch (error) {
        if (error instanceof SponsorWelcomeEmailRepositoryError) {
          caught = error
        }
      }
      expect(caught).not.toBeNull()
      expect(caught).toMatchObject(expected)
    }
  })
})

test.describe("sponsor welcome transport, authorization, and config", () => {
  test("uses constant-time bearer authorization semantics", () => {
    const secret = "a".repeat(32)
    expect(
      isAuthorizedSponsorWelcomeEmailWorkerRequest(`Bearer ${secret}`, secret),
    ).toBe(true)
    expect(
      isAuthorizedSponsorWelcomeEmailWorkerRequest(`Bearer ${secret} `, secret),
    ).toBe(false)
    expect(isAuthorizedSponsorWelcomeEmailWorkerRequest(null, secret)).toBe(
      false,
    )
  })

  test("loads bounded worker, canonical origin, SMTP, and cron fallback config", () => {
    const environment = {
      NODE_ENV: "production",
      NEXT_PUBLIC_BASE_URL: "https://creatorshare.com/path",
      CRON_SECRET: "b".repeat(32),
      EMAIL_HOST: "smtp.example.test",
      EMAIL_PORT: "587",
      EMAIL_SECURE: "false",
      EMAIL_USER: "smtp-user",
      EMAIL_PASSWORD: "smtp-password",
      EMAIL_FROM: '"Creator Share" <noreply@creatorshare.com>',
    }

    expect(loadSponsorWelcomeEmailWorkerConfig(environment)).toEqual({
      batchSize: 4,
      concurrency: 4,
      retryAfterSeconds: 300,
      transportTimeoutMilliseconds: 20_000,
      invocationSafetyMarginMilliseconds: 5_000,
    })
    expect(loadSponsorWelcomeEmailWorkerSecret(environment)).toBe(
      environment.CRON_SECRET,
    )
    expect(
      loadSponsorWelcomeEmailWorkerSecret({
        SPONSOR_WELCOME_EMAIL_WORKER_SECRET: "",
        CRON_SECRET: environment.CRON_SECRET,
      }),
    ).toBe(environment.CRON_SECRET)
    expect(() =>
      loadSponsorWelcomeEmailWorkerSecret({
        SPONSOR_WELCOME_EMAIL_WORKER_SECRET: " ".repeat(32),
        CRON_SECRET: environment.CRON_SECRET,
      }),
    ).toThrow("Sponsor welcome email configuration is unavailable")
    expect(loadSponsorWelcomeEmailCanonicalOrigin(environment)).toBe(
      "https://creatorshare.com",
    )
    expect(loadSponsorWelcomeEmailTransportConfig(environment)).toEqual({
      host: "smtp.example.test",
      port: 587,
      secure: false,
      username: "smtp-user",
      password: "smtp-password",
      fromAddress: "noreply@creatorshare.com",
      timeoutMilliseconds: 20_000,
    })
    expect(() =>
      loadSponsorWelcomeEmailWorkerConfig({
        SPONSOR_WELCOME_EMAIL_CONCURRENCY: "11",
      }),
    ).toThrow("Sponsor welcome email configuration is unavailable")
    expect(() =>
      loadSponsorWelcomeEmailWorkerConfig({
        SPONSOR_WELCOME_EMAIL_BATCH_SIZE: "5",
        SPONSOR_WELCOME_EMAIL_CONCURRENCY: "4",
      }),
    ).toThrow("Sponsor welcome email configuration is unavailable")
    expect(() =>
      loadSponsorWelcomeEmailWorkerConfig({
        SPONSOR_WELCOME_EMAIL_TRANSPORT_TIMEOUT_MILLISECONDS: "45000",
        SPONSOR_WELCOME_EMAIL_INVOCATION_SAFETY_MARGIN_MILLISECONDS: "15000",
      }),
    ).toThrow("Sponsor welcome email configuration is unavailable")
  })

  test("sends through the locked transport with a deterministic message ID", async () => {
    let transportOptions: Record<string, unknown> | null = null
    let mailOptions: Record<string, unknown> | null = null
    const transport = createNodemailerSponsorWelcomeEmailTransport(
      {
        host: "smtp.example.test",
        port: 587,
        secure: false,
        username: "smtp-user",
        password: "smtp-password",
        fromAddress: "noreply@creatorshare.com",
        timeoutMilliseconds: 20_000,
      },
      {
        createTransport(options) {
          transportOptions = options
          return {
            async sendMail(message) {
              mailOptions = message
              return { accepted: ["accepted"], rejected: [] }
            },
          }
        },
      },
    )

    const result = await transport.send({
      outboxId: OUTBOX_ID,
      providerMessageId: PROVIDER_MESSAGE_ID,
      recipientEmail: RECIPIENT,
      subject: "Welcome to the Creator Share family",
      text: "Welcome",
      html: "<p>Welcome</p>",
    })

    expect(result.providerMessageId).toBe(sponsorWelcomeMessageId(OUTBOX_ID))
    expect(transportOptions).toMatchObject({
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
      requireTLS: true,
      socketTimeout: 20_000,
    })
    expect(mailOptions).toMatchObject({
      messageId: PROVIDER_MESSAGE_ID,
      disableFileAccess: true,
      disableUrlAccess: true,
    })
  })

  test("returns only a static transport error after rejection", async () => {
    const transport = createNodemailerSponsorWelcomeEmailTransport(
      {
        host: "smtp.example.test",
        port: 587,
        secure: false,
        username: "smtp-user",
        password: "smtp-password",
        fromAddress: "noreply@creatorshare.com",
        timeoutMilliseconds: 20_000,
      },
      {
        createTransport() {
          return {
            async sendMail() {
              throw new Error("provider diagnostic")
            },
          }
        },
      },
    )

    await expect(
      transport.send({
        outboxId: OUTBOX_ID,
        providerMessageId: PROVIDER_MESSAGE_ID,
        recipientEmail: RECIPIENT,
        subject: "Welcome to the Creator Share family",
        text: "Welcome",
        html: "<p>Welcome</p>",
      }),
    ).rejects.toThrow("sponsor_welcome_email_transport_failed")
  })

  test("bounds an SMTP call whose acceptance response never arrives", async () => {
    const transport = createNodemailerSponsorWelcomeEmailTransport(
      {
        host: "smtp.example.test",
        port: 587,
        secure: false,
        username: "smtp-user",
        password: "smtp-password",
        fromAddress: "noreply@creatorshare.com",
        timeoutMilliseconds: 10,
      },
      {
        createTransport() {
          return {
            async sendMail() {
              return new Promise<never>(() => {})
            },
          }
        },
      },
    )

    await expect(
      transport.send({
        outboxId: OUTBOX_ID,
        providerMessageId: PROVIDER_MESSAGE_ID,
        recipientEmail: RECIPIENT,
        subject: "Welcome to the Creator Share family",
        text: "Welcome",
        html: "<p>Welcome</p>",
      }),
    ).rejects.toThrow("sponsor_welcome_email_transport_failed")
  })
})
