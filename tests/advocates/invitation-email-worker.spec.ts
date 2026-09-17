import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import Module from "node:module"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { AdvocateInvitationEmailProofResult } from "../../src/lib/auth/supabaseEmailProofIssuer"

import type {
  AdvocateInvitationEmailRepository,
  AdvocateInvitationEmailTransport,
  AdvocateInvitationEmailWorkerDependencies,
  ClaimedAdvocateInvitationEmail,
} from "../../src/lib/advocates/invitations/emailWorker"

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
  if (request === "@/lib/auth/supabaseEmailProofIssuer") {
    return {
      EMAIL_PROOF_AMBIGUOUS_RETRY_AFTER_SECONDS: 3900,
      EMAIL_PROOF_ISSUER_WORST_CASE_DURATION_MILLISECONDS: 42_000,
      async issueAdvocateInvitationEmailProof() {
        throw new Error("shared issuer must be injected in this unit suite")
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}
const testRequire = createRequire(
  resolve(process.cwd(), "tests/advocates/invitation-email-worker.spec.ts"),
)
const { createSponsorshipCrypto, toSupabaseRpcBytea } = testRequire(
  "../../src/lib/sponsorships/crypto",
) as typeof import("../../src/lib/sponsorships/crypto")
const {
  AdvocateInvitationEmailEnvelopeError,
  createAdvocateInvitationSecretEnvelope,
  openAdvocateInvitationSecretMaterial,
  parseAdvocateInvitationEmailTemplateData,
} = testRequire(
  "../../src/lib/advocates/invitations/emailEnvelope",
) as typeof import("../../src/lib/advocates/invitations/emailEnvelope")
const { createSharedAdvocateInvitationAuthProvider } = testRequire(
  "../../src/lib/advocates/invitations/emailAuth",
) as typeof import("../../src/lib/advocates/invitations/emailAuth")
const {
  loadAdvocateInvitationEmailCanonicalOrigin,
  loadAdvocateInvitationEmailTransportConfig,
  loadAdvocateInvitationEmailWorkerConfig,
  loadAdvocateInvitationEmailWorkerSecret,
} = testRequire(
  "../../src/lib/advocates/invitations/emailConfig",
) as typeof import("../../src/lib/advocates/invitations/emailConfig")
const { advocateInvitationMessageId } = testRequire(
  "../../src/lib/advocates/invitations/emailMessageId",
) as typeof import("../../src/lib/advocates/invitations/emailMessageId")
const { renderAdvocateInvitationEmail } = testRequire(
  "../../src/lib/advocates/invitations/emailRenderer",
) as typeof import("../../src/lib/advocates/invitations/emailRenderer")
const { createSupabaseAdvocateInvitationEmailRepository } = testRequire(
  "../../src/lib/advocates/invitations/emailRepository",
) as typeof import("../../src/lib/advocates/invitations/emailRepository")
const invitationEmailRoute = testRequire(
  "../../src/lib/advocates/invitations/emailRoute",
) as typeof import("../../src/lib/advocates/invitations/emailRoute")
const { advocateInvitationRequestContext } = testRequire(
  "../../src/lib/advocates/invitations/requestContext",
) as typeof import("../../src/lib/advocates/invitations/requestContext")
const { createNodemailerAdvocateInvitationEmailTransport } = testRequire(
  "../../src/lib/advocates/invitations/emailTransport",
) as typeof import("../../src/lib/advocates/invitations/emailTransport")
const {
  ADVOCATE_INVITATION_EMAIL_INVOCATION_BUDGET_MILLISECONDS,
  AdvocateInvitationEmailRepositoryError,
  AdvocateInvitationEmailTransportError,
  advocateInvitationPreIssuerHeadroomMilliseconds,
  processAdvocateInvitationEmail,
  runAdvocateInvitationEmailBatch,
} = testRequire(
  "../../src/lib/advocates/invitations/emailWorker",
) as typeof import("../../src/lib/advocates/invitations/emailWorker")
const { isAuthorizedAdvocateInvitationEmailWorkerRequest } = testRequire(
  "../../src/lib/advocates/invitations/emailWorkerAuthorization",
) as typeof import("../../src/lib/advocates/invitations/emailWorkerAuthorization")
nodeModule._load = originalModuleLoad

const APP_SECRET = Buffer.alloc(32, 31).toString("base64")
const OUTBOX_ID = "11111111-1111-4111-8111-111111111111"
const INVITATION_ID = "22222222-2222-4222-8222-222222222222"
const ADVOCATE_ID = "33333333-3333-4333-8333-333333333333"
const USER_ID = "44444444-4444-4444-8444-444444444444"
const REQUEST_ID = "55555555-5555-4555-8555-555555555555"
const WORKER_ID = "66666666-6666-4666-8666-666666666666"
const SECRET = "invitation-worker-secret-value-1234567890"
const LEASE_TOKEN = "a1".repeat(32)
const CAPABILITY = "b2".repeat(32)
const AUTH_TOKEN_HASH = "Auth_hash.value~with-safe-characters_".repeat(2)
const RECIPIENT = "delegate@example.test"
const NOW = Date.parse("2026-07-18T12:00:00.000Z")
const context = { requestId: REQUEST_ID, traceId: "trace-reference" }
const config = {
  batchSize: 2,
  concurrency: 2,
  retryAfterSeconds: 300,
  serviceRequestTimeoutMilliseconds: 5_000,
  transportTimeoutMilliseconds: 20_000,
  invocationSafetyMarginMilliseconds: 5_000,
}

const crypto = createSponsorshipCrypto({ appSecretBase64: APP_SECRET })

function claimedJob(
  overrides: Partial<ClaimedAdvocateInvitationEmail> = {},
): ClaimedAdvocateInvitationEmail {
  const recipient = crypto.encryptRecipientEmail(RECIPIENT)
  return {
    outboxId: OUTBOX_ID,
    invitationId: INVITATION_ID,
    advocateId: ADVOCATE_ID,
    leaseToken: LEASE_TOKEN,
    leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    targetAuthUserId: null,
    templateKey: "advocate_delegate_invitation_v1",
    templateData: {
      advocate_display_name: "Hope Partners",
      invitation_id: INVITATION_ID,
      role_keys: ["analytics_viewer", "brand_editor"],
    },
    recipientEmailCiphertext: recipient.ciphertextRpcBytea,
    recipientEmailHmac: crypto.digestEmail(RECIPIENT).digestRpcBytea,
    secretPayloadCiphertext: createAdvocateInvitationSecretEnvelope(
      CAPABILITY,
      crypto,
    ),
    capabilityDigest: toSupabaseRpcBytea(
      createHash("sha256").update(CAPABILITY, "utf8").digest(),
    ),
    emailNormalizationVersion: 1,
    emailHmacKeyVersion: 1,
    emailEncryptionKeyVersion: 1,
    providerIdempotencyKey: `advocate-invitation:${OUTBOX_ID}`,
    attemptCount: 1,
    ...overrides,
  }
}

function repository(
  overrides: Partial<AdvocateInvitationEmailRepository> = {},
): AdvocateInvitationEmailRepository {
  return {
    async claimJobs() {
      return []
    },
    async settleProofIssuance(options) {
      return {
        retryable: true,
        attemptRefunded:
          options.disposition === "coalesced" ||
          options.disposition === "deferred" ||
          options.disposition === "begin_ambiguous" ||
          options.disposition === "unavailable",
      }
    },
    async bindTarget() {},
    async beginDelivery(options) {
      return {
        providerIdempotencyKey: options.job.providerIdempotencyKey,
      }
    },
    async settleDelivery(options) {
      return {
        status: options.outcome === "sent" ? "sent" : "failed",
        retryable: options.outcome === "confirmed_not_sent",
      }
    },
    async failDelivery() {
      return { retryable: true }
    },
    ...overrides,
  }
}

const acceptingTransport: AdvocateInvitationEmailTransport = {
  async send(message) {
    return { providerMessageId: message.providerMessageId }
  },
}

function dependencies(
  overrides: Partial<AdvocateInvitationEmailWorkerDependencies> = {},
): AdvocateInvitationEmailWorkerDependencies {
  return {
    repository: repository(),
    authProvider: {
      async issueEmailProof() {
        return {
          status: "issued",
          proof: {
            userId: USER_ID,
            hashedToken: AUTH_TOKEN_HASH,
            authType: "magiclink",
          },
        }
      },
    },
    transport: acceptingTransport,
    crypto,
    canonicalOrigin: "https://creatorshare.com",
    now: () => NOW,
    ...overrides,
  }
}

test.describe("advocate invitation email envelopes", () => {
  test("opens only the exact canonical capability payload", () => {
    const plaintext = crypto.decryptSecretPayload(
      Buffer.from(
        createAdvocateInvitationSecretEnvelope(CAPABILITY, crypto).slice(2),
        "hex",
      ),
    )
    const opened = openAdvocateInvitationSecretMaterial(plaintext)
    plaintext.fill(0)
    expect(opened.capability).toBe(CAPABILITY)
    expect(opened.capabilityDigest).toBe(
      toSupabaseRpcBytea(
        createHash("sha256").update(CAPABILITY, "utf8").digest(),
      ),
    )

    for (const invalid of [
      JSON.stringify({ capability: CAPABILITY, version: 1 }),
      JSON.stringify({ version: 1, capability: CAPABILITY.toUpperCase() }),
      JSON.stringify({ version: 1, capability: CAPABILITY, extra: true }),
      JSON.stringify({ version: 2, capability: CAPABILITY }),
      "not-json",
    ]) {
      expect(() =>
        openAdvocateInvitationSecretMaterial(Buffer.from(invalid)),
      ).toThrow(AdvocateInvitationEmailEnvelopeError)
    }
  })

  test("requires the exact bounded template and canonical role ordering", () => {
    expect(
      parseAdvocateInvitationEmailTemplateData(
        "advocate_delegate_invitation_v1",
        {
          advocate_display_name: "Hope Partners",
          invitation_id: INVITATION_ID,
          role_keys: ["analytics_viewer", "brand_editor"],
        },
      ),
    ).toEqual({
      templateKey: "advocate_delegate_invitation_v1",
      advocateDisplayName: "Hope Partners",
      invitationId: INVITATION_ID,
      roleKeys: ["analytics_viewer", "brand_editor"],
    })
    for (const invalid of [
      {
        advocate_display_name: "Hope Partners",
        invitation_id: INVITATION_ID,
        role_keys: ["brand_editor", "analytics_viewer"],
      },
      {
        advocate_display_name: "Hope Partners",
        invitation_id: INVITATION_ID,
        role_keys: ["owner"],
      },
      {
        advocate_display_name: "Hope Partners",
        invitation_id: INVITATION_ID,
        role_keys: ["brand_editor"],
        email: RECIPIENT,
      },
    ]) {
      expect(() =>
        parseAdvocateInvitationEmailTemplateData(
          "advocate_delegate_invitation_v1",
          invalid,
        ),
      ).toThrow(AdvocateInvitationEmailEnvelopeError)
    }
  })

  test("strictly discriminates the initial owner template without delegate roles", () => {
    const parsed = parseAdvocateInvitationEmailTemplateData(
      "advocate_initial_owner_invitation_v1",
      {
        advocate_display_name: "Hope Partners",
        invitation_id: INVITATION_ID,
      },
    )
    expect(parsed).toEqual({
      templateKey: "advocate_initial_owner_invitation_v1",
      advocateDisplayName: "Hope Partners",
      invitationId: INVITATION_ID,
    })
    expect(JSON.stringify(parsed)).not.toMatch(
      /role|email|capability|target|outbox/i,
    )
    expect(() =>
      parseAdvocateInvitationEmailTemplateData(
        "advocate_initial_owner_invitation_v1",
        {
          advocate_display_name: "Hope Partners",
          invitation_id: INVITATION_ID,
          role_keys: [],
        },
      ),
    ).toThrow(AdvocateInvitationEmailEnvelopeError)
  })

  test("renders both secrets only in a prefetch-safe URL fragment", () => {
    const rendered = renderAdvocateInvitationEmail({
      canonicalOrigin: "https://creatorshare.com",
      template: parseAdvocateInvitationEmailTemplateData(
        "advocate_delegate_invitation_v1",
        claimedJob().templateData,
      ),
      authTokenHash: AUTH_TOKEN_HASH,
      authType: "magiclink",
      capability: CAPABILITY,
    })
    const url = new URL(rendered.invitationUrl)
    expect(url.pathname).toBe("/advocate-invitation")
    expect(url.search).toBe("")
    const fragment = new URLSearchParams(url.hash.slice(1))
    expect(fragment.get("capability")).toBe(CAPABILITY)
    expect(fragment.get("auth")).toBe(AUTH_TOKEN_HASH)
    expect(rendered.invitationUrl.split("#")[0]).not.toContain(CAPABILITY)
    expect(rendered.text).toContain("seven days")
    expect(rendered.text).toContain("sign-in proof expires sooner")
    expect(rendered.html).toContain("ask a portal administrator to resend it")
  })

  test("renders initial owner acceptance without delegate access language", () => {
    const rendered = renderAdvocateInvitationEmail({
      canonicalOrigin: "https://creatorshare.com",
      template: parseAdvocateInvitationEmailTemplateData(
        "advocate_initial_owner_invitation_v1",
        {
          advocate_display_name: "Hope Partners",
          invitation_id: INVITATION_ID,
        },
      ),
      authTokenHash: AUTH_TOKEN_HASH,
      authType: "signup",
      capability: CAPABILITY,
    })
    expect(rendered.subject).toBe("Claim your Creator Share advocate portal")
    expect(rendered.text).toContain("Claim ownership securely")
    expect(rendered.text).toContain("provider setup")
    expect(rendered.text).not.toContain("Access:")
    expect(rendered.html).toContain("Claim portal ownership")
    expect(rendered.html).not.toContain("<strong>Access:</strong>")
  })
})

test.describe("advocate invitation auth and persistence adapters", () => {
  test("forwards the exact durable operation and worker context to the shared issuer", async () => {
    const calls: unknown[] = []
    const expected = {
      status: "issued" as const,
      proof: {
        userId: USER_ID,
        hashedToken: AUTH_TOKEN_HASH,
        authType: "signup" as const,
      },
    }
    const provider = createSharedAdvocateInvitationAuthProvider(
      async (options) => {
        calls.push(options)
        return expected
      },
    )
    await expect(
      provider.issueEmailProof({
        recipientEmail: RECIPIENT,
        redirectTo: "https://creatorshare.com/advocate-invitation",
        outboxId: OUTBOX_ID,
        context,
      }),
    ).resolves.toEqual(expected)
    expect(calls).toEqual([
      {
        recipientEmail: RECIPIENT,
        redirectTo: "https://creatorshare.com/advocate-invitation",
        outboxId: OUTBOX_ID,
        context,
      },
    ])
  })

  test("maps the dedicated claim, proof settlement, bind, begin, settle, and fail RPCs exactly", async () => {
    const job = claimedJob()
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args })
        if (name === "claim_advocate_invitation_email_jobs") {
          return {
            data: [
              {
                outbox_id: job.outboxId,
                invitation_id: job.invitationId,
                advocate_id: job.advocateId,
                lease_token: job.leaseToken,
                lease_expires_at: job.leaseExpiresAt,
                target_auth_user_id: null,
                template_key: job.templateKey,
                template_data: job.templateData,
                recipient_email_ciphertext: job.recipientEmailCiphertext,
                recipient_email_hmac: job.recipientEmailHmac,
                secret_payload_ciphertext: job.secretPayloadCiphertext,
                capability_digest: job.capabilityDigest,
                email_normalization_version: 1,
                email_hmac_key_version: 1,
                email_encryption_key_version: 1,
                provider_idempotency_key: job.providerIdempotencyKey,
                attempt_count: 1,
              },
            ],
            error: null,
          }
        }
        if (name === "bind_advocate_invitation_email_target") {
          return { data: true, error: null }
        }
        if (name === "settle_advocate_invitation_email_proof_issuance") {
          return {
            data: [
              {
                retryable: true,
                attempt_refunded: true,
                available_at: "2026-07-18T12:05:00.000Z",
                settled_at: "2026-07-18T12:00:00.000Z",
              },
            ],
            error: null,
          }
        }
        if (name === "begin_advocate_invitation_email_delivery") {
          return { data: job.providerIdempotencyKey, error: null }
        }
        if (name === "settle_advocate_invitation_email_delivery") {
          return {
            data: [
              {
                status: "sent",
                retryable: false,
                settled_at: "2026-07-18T12:00:01.000Z",
              },
            ],
            error: null,
          }
        }
        return { data: true, error: null }
      },
    } as unknown as SupabaseClient
    const adapter = createSupabaseAdvocateInvitationEmailRepository(client)
    const [claimed] = await adapter.claimJobs({
      workerId: `advocate-invitation-email:${WORKER_ID}`,
      batchSize: 2,
      context,
    })
    expect(claimed).toEqual(job)
    await adapter.settleProofIssuance({
      job,
      disposition: "deferred",
      retryAfterSeconds: 300,
      context,
    })
    await adapter.bindTarget({
      job,
      targetUserId: USER_ID,
      verifiedRecipientEmailHmac: job.recipientEmailHmac,
      verifiedCapabilityDigest: job.capabilityDigest,
      context,
    })
    await adapter.beginDelivery({
      job,
      verifiedRecipientEmailHmac: job.recipientEmailHmac,
      verifiedCapabilityDigest: job.capabilityDigest,
      context,
    })
    await adapter.settleDelivery({
      job,
      outcome: "sent",
      providerMessageId: advocateInvitationMessageId(OUTBOX_ID),
      errorCode: null,
      retryAfterSeconds: 300,
      context,
    })
    await adapter.failDelivery({
      job,
      errorCode: "internal_error",
      retryAfterSeconds: 300,
      context,
    })
    expect(calls.map((call) => call.name)).toEqual([
      "claim_advocate_invitation_email_jobs",
      "settle_advocate_invitation_email_proof_issuance",
      "bind_advocate_invitation_email_target",
      "begin_advocate_invitation_email_delivery",
      "settle_advocate_invitation_email_delivery",
      "fail_advocate_invitation_email_delivery",
    ])
    expect(calls[0].args).toEqual({
      worker_id: `advocate-invitation-email:${WORKER_ID}`,
      batch_size: 2,
      shared_email_proof_issuer_version: 1,
      request_id: REQUEST_ID,
      trace_id: context.traceId,
    })
    expect(calls[1].args).toEqual({
      target_outbox_id: OUTBOX_ID,
      lease_token: LEASE_TOKEN,
      proof_disposition: "deferred",
      retry_after_seconds: 300,
      context_request_id: REQUEST_ID,
      context_trace_id: context.traceId,
    })
    expect(calls[2].args).toMatchObject({
      target_user_id: USER_ID,
      verified_recipient_email_hmac: job.recipientEmailHmac,
      verified_capability_digest: job.capabilityDigest,
      request_id: REQUEST_ID,
      trace_id: context.traceId,
    })
  })

  test("accepts the strict initial owner claim projection from the repository", async () => {
    const job = claimedJob({
      templateKey: "advocate_initial_owner_invitation_v1",
      templateData: {
        advocate_display_name: "Hope Partners",
        invitation_id: INVITATION_ID,
      },
    })
    const adapter = createSupabaseAdvocateInvitationEmailRepository({
      async rpc(name: string) {
        expect(name).toBe("claim_advocate_invitation_email_jobs")
        return {
          data: [
            {
              outbox_id: job.outboxId,
              invitation_id: job.invitationId,
              advocate_id: job.advocateId,
              lease_token: job.leaseToken,
              lease_expires_at: job.leaseExpiresAt,
              target_auth_user_id: null,
              template_key: job.templateKey,
              template_data: job.templateData,
              recipient_email_ciphertext: job.recipientEmailCiphertext,
              recipient_email_hmac: job.recipientEmailHmac,
              secret_payload_ciphertext: job.secretPayloadCiphertext,
              capability_digest: job.capabilityDigest,
              email_normalization_version: 1,
              email_hmac_key_version: 1,
              email_encryption_key_version: 1,
              provider_idempotency_key: job.providerIdempotencyKey,
              attempt_count: 1,
            },
          ],
          error: null,
        }
      },
    } as unknown as SupabaseClient)
    await expect(
      adapter.claimJobs({
        workerId: `advocate-invitation-email:${WORKER_ID}`,
        batchSize: 1,
        context,
      }),
    ).resolves.toEqual([job])
  })

  test("rejects a retryable target-mismatch settlement row", async () => {
    const adapter = createSupabaseAdvocateInvitationEmailRepository({
      async rpc(name: string) {
        expect(name).toBe("settle_advocate_invitation_email_proof_issuance")
        return {
          data: [
            {
              retryable: true,
              attempt_refunded: false,
              available_at: "2026-07-18T13:05:00.000Z",
              settled_at: "2026-07-18T12:00:00.000Z",
            },
          ],
          error: null,
        }
      },
    } as unknown as SupabaseClient)
    await expect(
      adapter.settleProofIssuance({
        job: claimedJob(),
        disposition: "issued_target_mismatch",
        retryAfterSeconds: 3900,
        context,
      }),
    ).rejects.toThrow(
      "advocate_invitation_email_repository_proof_settlement_shape",
    )
  })

  test("rejects a proof settlement available before it was settled", async () => {
    const adapter = createSupabaseAdvocateInvitationEmailRepository({
      async rpc(name: string) {
        expect(name).toBe("settle_advocate_invitation_email_proof_issuance")
        return {
          data: [
            {
              retryable: true,
              attempt_refunded: true,
              available_at: "2026-07-18T11:59:59.999Z",
              settled_at: "2026-07-18T12:00:00.000Z",
            },
          ],
          error: null,
        }
      },
    } as unknown as SupabaseClient)
    await expect(
      adapter.settleProofIssuance({
        job: claimedJob(),
        disposition: "deferred",
        retryAfterSeconds: 300,
        context,
      }),
    ).rejects.toThrow(
      "advocate_invitation_email_repository_proof_settlement_shape",
    )
  })

  test("rejects extra claim fields and duplicate claims", async () => {
    const invalidRow = {
      outbox_id: OUTBOX_ID,
      invitation_id: INVITATION_ID,
      advocate_id: ADVOCATE_ID,
      lease_token: LEASE_TOKEN,
      lease_expires_at: "2099-01-01T00:00:00.000Z",
      target_auth_user_id: null,
      template_key: "advocate_delegate_invitation_v1",
      template_data: claimedJob().templateData,
      recipient_email_ciphertext: claimedJob().recipientEmailCiphertext,
      recipient_email_hmac: claimedJob().recipientEmailHmac,
      secret_payload_ciphertext: claimedJob().secretPayloadCiphertext,
      capability_digest: claimedJob().capabilityDigest,
      email_normalization_version: 1,
      email_hmac_key_version: 1,
      email_encryption_key_version: 1,
      provider_idempotency_key: `advocate-invitation:${OUTBOX_ID}`,
      attempt_count: 1,
      plaintext_capability: CAPABILITY,
    }
    const adapter = createSupabaseAdvocateInvitationEmailRepository({
      async rpc() {
        return { data: [invalidRow], error: null }
      },
    } as unknown as SupabaseClient)
    await expect(
      adapter.claimJobs({ workerId: "worker", batchSize: 1, context }),
    ).rejects.toThrow("advocate_invitation_email_repository_claim_shape")
  })
})

test.describe("advocate invitation delivery worker", () => {
  test("binds the exact account before handoff, send, and settlement", async () => {
    const stages: string[] = []
    let deliveredUrl = ""
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob(),
      context,
      invocationDeadlineAt: NOW + 120_000,
      dependencies: dependencies({
        authProvider: {
          async issueEmailProof(options) {
            stages.push("auth")
            expect(options).toEqual({
              recipientEmail: RECIPIENT,
              redirectTo: "https://creatorshare.com/advocate-invitation",
              outboxId: OUTBOX_ID,
              context,
            })
            return {
              status: "issued",
              proof: {
                userId: USER_ID,
                hashedToken: AUTH_TOKEN_HASH,
                authType: "signup",
              },
            }
          },
        },
        repository: repository({
          async bindTarget(options) {
            stages.push("bind")
            expect(options.targetUserId).toBe(USER_ID)
          },
          async beginDelivery(options) {
            stages.push("begin")
            return {
              providerIdempotencyKey: options.job.providerIdempotencyKey,
            }
          },
          async settleDelivery(options) {
            stages.push("settle")
            expect(options.outcome).toBe("sent")
            return { status: "sent", retryable: false }
          },
        }),
        transport: {
          async send(message) {
            stages.push("send")
            deliveredUrl =
              message.text.match(
                /https:\/\/creatorshare\.com\/advocate-invitation#[^\s]+/,
              )?.[0] ?? ""
            return { providerMessageId: message.providerMessageId }
          },
        },
      }),
    })
    expect(result).toEqual({ outboxId: OUTBOX_ID, status: "sent" })
    expect(stages).toEqual(["auth", "bind", "begin", "send", "settle"])
    expect(new URL(deliveredUrl).search).toBe("")
    expect(new URL(deliveredUrl).hash).toContain(CAPABILITY)
    expect(
      new URLSearchParams(new URL(deliveredUrl).hash.slice(1)).get("type"),
    ).toBe("signup")
  })

  test("delivers an initial owner invitation through the same exact account fence", async () => {
    const stages: string[] = []
    let deliveredText = ""
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob({
        templateKey: "advocate_initial_owner_invitation_v1",
        templateData: {
          advocate_display_name: "Hope Partners",
          invitation_id: INVITATION_ID,
        },
      }),
      context,
      invocationDeadlineAt: NOW + 120_000,
      dependencies: dependencies({
        authProvider: {
          async issueEmailProof() {
            stages.push("auth")
            return {
              status: "issued",
              proof: {
                userId: USER_ID,
                hashedToken: AUTH_TOKEN_HASH,
                authType: "magiclink",
              },
            }
          },
        },
        repository: repository({
          async bindTarget(options) {
            stages.push("bind")
            expect(options.targetUserId).toBe(USER_ID)
          },
          async beginDelivery(options) {
            stages.push("begin")
            return {
              providerIdempotencyKey: options.job.providerIdempotencyKey,
            }
          },
          async settleDelivery() {
            stages.push("settle")
            return { status: "sent", retryable: false }
          },
        }),
        transport: {
          async send(message) {
            stages.push("send")
            deliveredText = message.text
            return { providerMessageId: message.providerMessageId }
          },
        },
      }),
    })
    expect(result).toEqual({ outboxId: OUTBOX_ID, status: "sent" })
    expect(stages).toEqual(["auth", "bind", "begin", "send", "settle"])
    expect(deliveredText).toContain("Claim ownership securely")
    expect(deliveredText).not.toContain("Access:")
  })

  test("terminalizes a digest mismatch before account creation or send", async () => {
    let authCalled = false
    let failureCode: string | null = null
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob({ recipientEmailHmac: `\\x${"00".repeat(32)}` }),
      context,
      invocationDeadlineAt: NOW + 120_000,
      dependencies: dependencies({
        authProvider: {
          async issueEmailProof() {
            authCalled = true
            return {
              status: "issued",
              proof: {
                userId: USER_ID,
                hashedToken: AUTH_TOKEN_HASH,
                authType: "magiclink",
              },
            }
          },
        },
        repository: repository({
          async failDelivery(options) {
            failureCode = options.errorCode
            return { retryable: false }
          },
        }),
      }),
    })
    expect(result.status).toBe("terminal_failed")
    expect(failureCode).toBe("invitation_email_material_invalid")
    expect(authCalled).toBe(false)
  })

  test("rejects a staging-disallowed recipient before proof issuance or handoff", async () => {
    const stages: string[] = []
    let failureCode: string | null = null
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob(),
      context,
      invocationDeadlineAt: NOW + 120_000,
      dependencies: dependencies({
        assertRecipientAllowed() {
          stages.push("recipient-policy")
          throw new Error("staging recipient rejected")
        },
        authProvider: {
          async issueEmailProof() {
            stages.push("auth")
            throw new Error("must not issue")
          },
        },
        repository: repository({
          async beginDelivery() {
            stages.push("begin")
            throw new Error("must not begin")
          },
          async failDelivery(options) {
            stages.push("fail")
            failureCode = options.errorCode
            return { retryable: false }
          },
        }),
        transport: {
          async send() {
            stages.push("send")
            throw new Error("must not send")
          },
        },
      }),
    })

    expect(result.status).toBe("terminal_failed")
    expect(failureCode).toBe("internal_error")
    expect(stages).toEqual(["recipient-policy", "fail"])
  })

  test("fences an unexpected issuer failure as ambiguous", async () => {
    let proofSettlement: Record<string, unknown> | null = null
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob(),
      context,
      invocationDeadlineAt: NOW + 120_000,
      dependencies: dependencies({
        authProvider: {
          async issueEmailProof() {
            throw new Error("lost issuer response")
          },
        },
        repository: repository({
          async settleProofIssuance(options) {
            proofSettlement = options
            return { retryable: true, attemptRefunded: false }
          },
        }),
      }),
    })
    expect(result.status).toBe("retried")
    expect(result.code).toBe("email_proof_issuance_ambiguous")
    expect(proofSettlement).toMatchObject({
      disposition: "ambiguous",
      retryAfterSeconds: 3900,
    })
  })

  const proofDeferralScenarios: Array<{
    name: string
    issuance: AdvocateInvitationEmailProofResult
    disposition: string
    retryAfterSeconds: number
    attemptRefunded: boolean
    code: string
  }> = [
    {
      name: "coalesced zero delay",
      issuance: { status: "coalesced", retryAfterSeconds: 0 },
      disposition: "coalesced",
      retryAfterSeconds: 0,
      attemptRefunded: true,
      code: "email_proof_deferred",
    },
    {
      name: "coalesced positive delay",
      issuance: { status: "coalesced", retryAfterSeconds: 73 },
      disposition: "coalesced",
      retryAfterSeconds: 73,
      attemptRefunded: true,
      code: "email_proof_deferred",
    },
    {
      name: "deferred",
      issuance: { status: "deferred", retryAfterSeconds: 41 },
      disposition: "deferred",
      retryAfterSeconds: 41,
      attemptRefunded: true,
      code: "email_proof_deferred",
    },
    {
      name: "provider ambiguous",
      issuance: { status: "ambiguous", retryAfterSeconds: 3900 },
      disposition: "ambiguous",
      retryAfterSeconds: 3900,
      attemptRefunded: false,
      code: "email_proof_issuance_ambiguous",
    },
    ...(["configuration", "acquire"] as const).map((stage) => ({
      name: `${stage} unavailable`,
      issuance: { status: "unavailable" as const, stage },
      disposition: "unavailable",
      retryAfterSeconds: 300,
      attemptRefunded: true,
      code: "email_proof_unavailable",
    })),
    {
      name: "begin ambiguous",
      issuance: {
        status: "unavailable",
        stage: "begin",
        retryAfterSeconds: 3900,
      },
      disposition: "begin_ambiguous",
      retryAfterSeconds: 3900,
      attemptRefunded: true,
      code: "email_proof_issuance_ambiguous",
    },
  ]

  for (const scenario of proofDeferralScenarios) {
    test(`settles ${scenario.name} with the exact shared issuer delay`, async () => {
      let issuerCalls = 0
      let transportCalls = 0
      let settlement: Record<string, unknown> | null = null
      const result = await processAdvocateInvitationEmail({
        config,
        job: claimedJob(),
        context,
        invocationDeadlineAt: NOW + 120_000,
        dependencies: dependencies({
          authProvider: {
            async issueEmailProof() {
              issuerCalls += 1
              return scenario.issuance
            },
          },
          repository: repository({
            async settleProofIssuance(options) {
              settlement = options
              return {
                retryable: true,
                attemptRefunded: scenario.attemptRefunded,
              }
            },
          }),
          transport: {
            async send(message) {
              transportCalls += 1
              return { providerMessageId: message.providerMessageId }
            },
          },
        }),
      })
      expect(result).toMatchObject({ status: "retried", code: scenario.code })
      expect(settlement).toMatchObject({
        disposition: scenario.disposition,
        retryAfterSeconds: scenario.retryAfterSeconds,
      })
      expect(issuerCalls).toBe(1)
      expect(transportCalls).toBe(0)
    })
  }

  test("classifies an exact bound-account mismatch as target unavailable", async () => {
    let proofSettlement: Record<string, unknown> | null = null
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob({
        targetAuthUserId: "77777777-7777-4777-8777-777777777777",
      }),
      context,
      invocationDeadlineAt: NOW + 120_000,
      dependencies: dependencies({
        repository: repository({
          async settleProofIssuance(options) {
            proofSettlement = options
            return { retryable: false, attemptRefunded: false }
          },
        }),
      }),
    })
    expect(result).toMatchObject({
      status: "terminal_failed",
      code: "invitation_target_unavailable",
    })
    expect(proofSettlement).toMatchObject({
      disposition: "issued_target_mismatch",
      retryAfterSeconds: 3900,
    })
  })

  test("rejects a retryable target mismatch defensively in the worker", async () => {
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob({
        targetAuthUserId: "77777777-7777-4777-8777-777777777777",
      }),
      context,
      invocationDeadlineAt: NOW + 110_000,
      dependencies: dependencies({
        repository: repository({
          async settleProofIssuance() {
            return { retryable: true, attemptRefunded: false }
          },
        }),
      }),
    })
    expect(result).toMatchObject({
      status: "settlement_unknown",
      code: "invitation_target_unavailable",
    })
  })

  test("terminalizes a bind target mismatch through the issued proof receipt", async () => {
    let proofSettlement: Record<string, unknown> | null = null
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob(),
      context,
      invocationDeadlineAt: NOW + 120_000,
      dependencies: dependencies({
        repository: repository({
          async bindTarget() {
            throw new AdvocateInvitationEmailRepositoryError("bind", {
              targetUnavailable: true,
            })
          },
          async settleProofIssuance(options) {
            proofSettlement = options
            return { retryable: false, attemptRefunded: false }
          },
        }),
      }),
    })
    expect(result).toMatchObject({
      status: "terminal_failed",
      code: "invitation_target_unavailable",
    })
    expect(proofSettlement).toMatchObject({
      disposition: "issued_target_mismatch",
      retryAfterSeconds: 3900,
    })
  })

  test("fences an issued proof when target binding fails before handoff", async () => {
    let transportCalled = false
    let proofSettlement: Record<string, unknown> | null = null
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob(),
      context,
      invocationDeadlineAt: NOW + 120_000,
      dependencies: dependencies({
        repository: repository({
          async bindTarget() {
            throw new AdvocateInvitationEmailRepositoryError("bind")
          },
          async settleProofIssuance(options) {
            proofSettlement = options
            return { retryable: true, attemptRefunded: false }
          },
        }),
        transport: {
          async send(message) {
            transportCalled = true
            return { providerMessageId: message.providerMessageId }
          },
        },
      }),
    })
    expect(result).toMatchObject({
      status: "retried",
      code: "email_proof_issued_not_handed_off",
    })
    expect(proofSettlement).toMatchObject({
      disposition: "issued_not_handed_off",
      retryAfterSeconds: 3900,
    })
    expect(transportCalled).toBe(false)
  })

  test("keeps a late target-mismatch settlement failure visible for attention", async () => {
    let nowCalls = 0
    let settlementCalls = 0
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob({
        targetAuthUserId: "77777777-7777-4777-8777-777777777777",
      }),
      context,
      invocationDeadlineAt: NOW + 110_000,
      dependencies: dependencies({
        now() {
          nowCalls += 1
          return nowCalls < 3 ? NOW : NOW + 100_000
        },
        repository: repository({
          async settleProofIssuance() {
            settlementCalls += 1
            return { retryable: false, attemptRefunded: false }
          },
        }),
      }),
    })
    expect(result).toMatchObject({
      status: "settlement_unknown",
      code: "invitation_target_unavailable",
    })
    expect(settlementCalls).toBe(0)
  })

  test("distinguishes exact post-issued invocation and lease settlement boundaries", async () => {
    const invocationOutcomes: string[] = []
    for (const extraHeadroom of [0, 1]) {
      let nowCalls = 0
      let settlementCalls = 0
      const result = await processAdvocateInvitationEmail({
        config,
        job: claimedJob(),
        context,
        invocationDeadlineAt: NOW + 110_000,
        dependencies: dependencies({
          now() {
            nowCalls += 1
            return nowCalls < 3 ? NOW : NOW + 100_000 - extraHeadroom
          },
          repository: repository({
            async bindTarget() {
              throw new AdvocateInvitationEmailRepositoryError("bind")
            },
            async settleProofIssuance() {
              settlementCalls += 1
              return { retryable: true, attemptRefunded: false }
            },
          }),
        }),
      })
      invocationOutcomes.push(result.status)
      expect(settlementCalls).toBe(extraHeadroom)
    }
    expect(invocationOutcomes).toEqual(["settlement_unknown", "retried"])

    let nowCalls = 0
    const leaseResult = await processAdvocateInvitationEmail({
      config,
      job: claimedJob({
        leaseExpiresAt: new Date(NOW + 100_000).toISOString(),
      }),
      context,
      invocationDeadlineAt: NOW + 110_000,
      dependencies: dependencies({
        now() {
          nowCalls += 1
          return nowCalls < 3 ? NOW : NOW + 90_000
        },
        repository: repository({
          async bindTarget() {
            throw new AdvocateInvitationEmailRepositoryError("bind")
          },
        }),
      }),
    })
    expect(leaseResult).toMatchObject({
      status: "lease_lost",
      code: "email_proof_issued_not_handed_off",
    })
  })

  test("settles a provider-confirmed rejection as retryable", async () => {
    let settlement: Record<string, unknown> | null = null
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob(),
      context,
      invocationDeadlineAt: NOW + 120_000,
      dependencies: dependencies({
        repository: repository({
          async settleDelivery(options) {
            settlement = options
            return { status: "failed", retryable: true }
          },
        }),
        transport: {
          async send() {
            throw new AdvocateInvitationEmailTransportError({
              confirmedNotSent: true,
              failureCode: "email_delivery_rejected",
            })
          },
        },
      }),
    })
    expect(result).toMatchObject({
      status: "retried",
      code: "email_delivery_rejected",
    })
    expect(settlement).toMatchObject({
      outcome: "confirmed_not_sent",
      providerMessageId: null,
      errorCode: "email_delivery_rejected",
    })
  })

  test("quarantines an ambiguous provider response without automatic retry", async () => {
    let failed = false
    let settled = false
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob(),
      context,
      invocationDeadlineAt: NOW + 120_000,
      dependencies: dependencies({
        repository: repository({
          async failDelivery() {
            failed = true
            return { retryable: true }
          },
          async settleDelivery() {
            settled = true
            return { status: "sent", retryable: false }
          },
        }),
        transport: {
          async send() {
            throw new AdvocateInvitationEmailTransportError()
          },
        },
      }),
    })
    expect(result).toEqual({
      outboxId: OUTBOX_ID,
      status: "manual_review",
      code: "invitation_email_acceptance_ambiguous",
    })
    expect(failed).toBe(false)
    expect(settled).toBe(false)
  })

  test("preserves deterministic delivery identity for an explicit lost-response retry", async () => {
    const messageIds: string[] = []
    const first = await processAdvocateInvitationEmail({
      config,
      job: claimedJob(),
      context,
      invocationDeadlineAt: NOW + 120_000,
      dependencies: dependencies({
        transport: {
          async send(message) {
            messageIds.push(message.providerMessageId)
            throw new AdvocateInvitationEmailTransportError()
          },
        },
      }),
    })
    expect(first.status).toBe("manual_review")

    const second = await processAdvocateInvitationEmail({
      config,
      job: claimedJob({ leaseToken: "c3".repeat(32), attemptCount: 2 }),
      context,
      invocationDeadlineAt: NOW + 120_000,
      dependencies: dependencies({
        transport: {
          async send(message) {
            messageIds.push(message.providerMessageId)
            return { providerMessageId: message.providerMessageId }
          },
        },
      }),
    })
    expect(second.status).toBe("sent")
    expect(messageIds).toEqual([
      advocateInvitationMessageId(OUTBOX_ID),
      advocateInvitationMessageId(OUTBOX_ID),
    ])
  })

  test("reports settlement unknown after provider acceptance without retrying", async () => {
    let failed = false
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob(),
      context,
      invocationDeadlineAt: NOW + 120_000,
      dependencies: dependencies({
        repository: repository({
          async settleDelivery() {
            throw new AdvocateInvitationEmailRepositoryError("settle")
          },
          async failDelivery() {
            failed = true
            return { retryable: true }
          },
        }),
      }),
    })
    expect(result.status).toBe("settlement_unknown")
    expect(failed).toBe(false)
  })

  test("refunds the attempt before auth when invocation headroom is insufficient", async () => {
    let authCalled = false
    let proofSettlement: Record<string, unknown> | null = null
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob(),
      context,
      invocationDeadlineAt: NOW + 30_000,
      dependencies: dependencies({
        authProvider: {
          async issueEmailProof() {
            authCalled = true
            return {
              status: "issued",
              proof: {
                userId: USER_ID,
                hashedToken: AUTH_TOKEN_HASH,
                authType: "magiclink",
              },
            }
          },
        },
        repository: repository({
          async settleProofIssuance(options) {
            proofSettlement = options
            return { retryable: true, attemptRefunded: true }
          },
        }),
      }),
    })
    expect(result.status).toBe("retried")
    expect(result.code).toBe("email_proof_deferred")
    expect(proofSettlement).toMatchObject({
      disposition: "deferred",
      retryAfterSeconds: 300,
    })
    expect(authCalled).toBe(false)
  })

  test("rejects exact pre-issuer headroom and accepts one millisecond more", async () => {
    const required = advocateInvitationPreIssuerHeadroomMilliseconds(config)
    const calls: Array<{ delta: number; issuer: number; transport: number }> =
      []
    for (const delta of [0, 1]) {
      const observed = { delta, issuer: 0, transport: 0 }
      const result = await processAdvocateInvitationEmail({
        config,
        job: claimedJob(),
        context,
        invocationDeadlineAt: NOW + required + delta,
        dependencies: dependencies({
          authProvider: {
            async issueEmailProof() {
              observed.issuer += 1
              return {
                status: "issued",
                proof: {
                  userId: USER_ID,
                  hashedToken: AUTH_TOKEN_HASH,
                  authType: "magiclink",
                },
              }
            },
          },
          transport: {
            async send(message) {
              observed.transport += 1
              return { providerMessageId: message.providerMessageId }
            },
          },
        }),
      })
      expect(result.status).toBe(delta === 0 ? "retried" : "sent")
      calls.push(observed)
    }
    expect(calls).toEqual([
      { delta: 0, issuer: 0, transport: 0 },
      { delta: 1, issuer: 1, transport: 1 },
    ])
  })

  test("rejects an exact lease boundary without invoking the issuer", async () => {
    const required = advocateInvitationPreIssuerHeadroomMilliseconds(config)
    let issuerCalls = 0
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob({
        leaseExpiresAt: new Date(NOW + required).toISOString(),
      }),
      context,
      invocationDeadlineAt: NOW + 120_000,
      dependencies: dependencies({
        authProvider: {
          async issueEmailProof() {
            issuerCalls += 1
            return {
              status: "issued",
              proof: {
                userId: USER_ID,
                hashedToken: AUTH_TOKEN_HASH,
                authType: "magiclink",
              },
            }
          },
        },
      }),
    })
    expect(result.status).toBe("lease_lost")
    expect(issuerCalls).toBe(0)
  })

  test("rechecks headroom immediately after proof issuance", async () => {
    const outcomes: string[] = []
    for (const extraHeadroom of [0, 1]) {
      let currentTime = NOW
      let settlement: Record<string, unknown> | null = null
      const result = await processAdvocateInvitationEmail({
        config,
        job: claimedJob(),
        context,
        invocationDeadlineAt: NOW + 120_000,
        dependencies: dependencies({
          now: () => currentTime,
          authProvider: {
            async issueEmailProof() {
              currentTime = NOW + 80_000 - extraHeadroom
              return {
                status: "issued",
                proof: {
                  userId: USER_ID,
                  hashedToken: AUTH_TOKEN_HASH,
                  authType: "magiclink",
                },
              }
            },
          },
          repository: repository({
            async settleProofIssuance(options) {
              settlement = options
              return { retryable: true, attemptRefunded: false }
            },
          }),
        }),
      })
      outcomes.push(result.status)
      if (extraHeadroom === 0) {
        expect(settlement).toMatchObject({
          disposition: "issued_not_handed_off",
          retryAfterSeconds: 3900,
        })
      }
    }
    expect(outcomes).toEqual(["retried", "sent"])
  })

  test("rechecks headroom immediately before delivery begin", async () => {
    const outcomes: string[] = []
    for (const extraHeadroom of [0, 1]) {
      let currentTime = NOW
      let beginCalls = 0
      let settlement: Record<string, unknown> | null = null
      const result = await processAdvocateInvitationEmail({
        config,
        job: claimedJob(),
        context,
        invocationDeadlineAt: NOW + 120_000,
        dependencies: dependencies({
          now: () => currentTime,
          repository: repository({
            async bindTarget() {
              currentTime = NOW + 85_000 - extraHeadroom
            },
            async beginDelivery(options) {
              beginCalls += 1
              return {
                providerIdempotencyKey: options.job.providerIdempotencyKey,
              }
            },
            async settleProofIssuance(options) {
              settlement = options
              return { retryable: true, attemptRefunded: false }
            },
          }),
        }),
      })
      outcomes.push(result.status)
      expect(beginCalls).toBe(extraHeadroom)
      if (extraHeadroom === 0) {
        expect(settlement).toMatchObject({
          disposition: "issued_not_handed_off",
          retryAfterSeconds: 3900,
        })
      }
    }
    expect(outcomes).toEqual(["retried", "sent"])
  })

  test("reports a failed pre-issuer deferral settlement without external calls", async () => {
    let issuerCalls = 0
    let transportCalls = 0
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob(),
      context,
      invocationDeadlineAt: NOW + 30_000,
      dependencies: dependencies({
        authProvider: {
          async issueEmailProof() {
            issuerCalls += 1
            throw new Error("must not run")
          },
        },
        repository: repository({
          async settleProofIssuance() {
            throw new AdvocateInvitationEmailRepositoryError("proof_settlement")
          },
        }),
        transport: {
          async send(message) {
            transportCalls += 1
            return { providerMessageId: message.providerMessageId }
          },
        },
      }),
    })
    expect(result).toMatchObject({
      status: "settlement_unknown",
      code: "email_proof_deferred",
    })
    expect(issuerCalls).toBe(0)
    expect(transportCalls).toBe(0)
  })

  test("rejects a batch that could queue claimed work locally", async () => {
    let claimCalls = 0
    await expect(
      runAdvocateInvitationEmailBatch({
        config: { ...config, concurrency: 1 },
        workerId: `advocate-invitation-email:${WORKER_ID}`,
        context,
        invocationDeadlineAt: NOW + 120_000,
        dependencies: dependencies({
          repository: repository({
            async claimJobs() {
              claimCalls += 1
              return [claimedJob(), claimedJob()]
            },
          }),
        }),
      }),
    ).rejects.toThrow(
      "Advocate invitation email worker configuration is invalid",
    )
    expect(claimCalls).toBe(0)
  })

  test("bounds batch concurrency and reports only aggregate outcomes", async () => {
    let active = 0
    let maximumActive = 0
    const jobs = [
      claimedJob(),
      claimedJob({
        outboxId: "88888888-8888-4888-8888-888888888888",
        providerIdempotencyKey:
          "advocate-invitation:88888888-8888-4888-8888-888888888888",
      }),
    ]
    const batch = await runAdvocateInvitationEmailBatch({
      config,
      workerId: `advocate-invitation-email:${WORKER_ID}`,
      context,
      invocationDeadlineAt: NOW + 120_000,
      dependencies: dependencies({
        repository: repository({
          async claimJobs() {
            return jobs
          },
        }),
        transport: {
          async send(message) {
            active += 1
            maximumActive = Math.max(maximumActive, active)
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 2))
            active -= 1
            return { providerMessageId: message.providerMessageId }
          },
        },
      }),
    })
    expect(batch).toMatchObject({ claimed: 2, sent: 2, retried: 0 })
    expect(maximumActive).toBe(2)
  })
})

test.describe("advocate invitation transport and route", () => {
  test("trusts invitation trace and IP metadata only on Vercel", () => {
    const request = new Request("https://creatorshare.com/portal", {
      headers: {
        "x-vercel-id": "sfo1::trusted-trace",
        "x-vercel-forwarded-for": "2001:0DB8:0:0:0:0:0:1",
        "cf-connecting-ip": "198.51.100.4",
        "x-forwarded-for": "198.51.100.5",
        "x-real-ip": "198.51.100.6",
        "user-agent": "Trusted Mobile Client",
      },
    })
    expect(
      advocateInvitationRequestContext(request, { VERCEL: "1" }),
    ).toMatchObject({
      traceId: "sfo1::trusted-trace",
      clientIp: "2001:0db8:0:0:0:0:0:1",
      userAgent: "Trusted Mobile Client",
    })
    expect(advocateInvitationRequestContext(request, {})).toMatchObject({
      traceId: null,
      clientIp: null,
      userAgent: "Trusted Mobile Client",
    })
    expect(
      advocateInvitationRequestContext(
        new Request("https://creatorshare.com/portal", {
          headers: {
            "x-vercel-id": "a".repeat(256),
            "x-vercel-forwarded-for": "203.0.113.1, 203.0.113.2",
          },
        }),
        { VERCEL: "1" },
      ),
    ).toMatchObject({ traceId: null, clientIp: null })
  })

  test("uses deterministic Message-ID and delivery key headers", async () => {
    let sent: Record<string, unknown> = {}
    const transport = createNodemailerAdvocateInvitationEmailTransport(
      {
        host: "smtp.example.test",
        port: 587,
        secure: false,
        username: "mailer@example.test",
        password: "smtp-secret",
        fromAddress: "hello@creatorshare.com",
        timeoutMilliseconds: 1_000,
      },
      {
        createTransport() {
          return {
            async sendMail(message) {
              sent = message
              return { accepted: [RECIPIENT], rejected: [] }
            },
          }
        },
      },
    )
    const messageId = advocateInvitationMessageId(OUTBOX_ID)
    await expect(
      transport.send({
        outboxId: OUTBOX_ID,
        providerMessageId: messageId,
        providerIdempotencyKey: `advocate-invitation:${OUTBOX_ID}`,
        recipientEmail: RECIPIENT,
        subject: "Invitation",
        text: "Text",
        html: "<p>Text</p>",
      }),
    ).resolves.toEqual({ providerMessageId: messageId })
    expect(sent.messageId).toBe(messageId)
    expect(sent.headers).toEqual({
      "X-Creator-Share-Delivery-Key": `advocate-invitation:${OUTBOX_ID}`,
    })
    expect(sent).toMatchObject({
      disableFileAccess: true,
      disableUrlAccess: true,
    })
  })

  test("marks a resolved all-recipient rejection as confirmed not sent", async () => {
    const transport = createNodemailerAdvocateInvitationEmailTransport(
      {
        host: "smtp.example.test",
        port: 587,
        secure: false,
        username: "mailer@example.test",
        password: "smtp-secret",
        fromAddress: "hello@creatorshare.com",
        timeoutMilliseconds: 1_000,
      },
      {
        createTransport() {
          return {
            async sendMail() {
              return { accepted: [], rejected: [RECIPIENT] }
            },
          }
        },
      },
    )
    await expect(
      transport.send({
        outboxId: OUTBOX_ID,
        providerMessageId: advocateInvitationMessageId(OUTBOX_ID),
        providerIdempotencyKey: `advocate-invitation:${OUTBOX_ID}`,
        recipientEmail: RECIPIENT,
        subject: "Invitation",
        text: "Text",
        html: "<p>Text</p>",
      }),
    ).rejects.toMatchObject({
      confirmedNotSent: true,
      failureCode: "email_delivery_rejected",
    })
  })

  test("loads a dedicated bounded configuration and constant-time worker auth", () => {
    const environment = {
      ADVOCATE_INVITATION_EMAIL_WORKER_SECRET: SECRET,
      EMAIL_HOST: "smtp.example.test",
      EMAIL_PORT: "587",
      EMAIL_SECURE: "false",
      EMAIL_USER: "mailer@example.test",
      EMAIL_PASSWORD: "smtp-secret",
      EMAIL_FROM: "Creator Share <hello@creatorshare.com>",
    }
    expect(loadAdvocateInvitationEmailWorkerSecret(environment)).toBe(SECRET)
    expect(loadAdvocateInvitationEmailWorkerConfig(environment)).toEqual(config)
    expect(
      loadAdvocateInvitationEmailTransportConfig(environment),
    ).toMatchObject({
      host: "smtp.example.test",
      fromAddress: "hello@creatorshare.com",
      timeoutMilliseconds: 20_000,
    })
    expect(loadAdvocateInvitationEmailCanonicalOrigin(environment)).toBe(
      "https://creatorshare.com",
    )
    expect(
      loadAdvocateInvitationEmailCanonicalOrigin({
        ...environment,
        NEXT_PUBLIC_BASE_URL: "https://advocate-staging.creatorshare.com",
        ADVOCATE_INVITATION_CANONICAL_ORIGIN:
          "https://advocate-staging.creatorshare.com",
      }),
    ).toBe("https://advocate-staging.creatorshare.com")
    for (const stagingEnvironment of [
      {
        ...environment,
        NEXT_PUBLIC_BASE_URL: "https://advocate-staging.creatorshare.com",
      },
      {
        ...environment,
        NEXT_PUBLIC_BASE_URL: "https://advocate-staging.creatorshare.com",
        ADVOCATE_INVITATION_CANONICAL_ORIGIN: "https://creatorshare.com",
      },
    ]) {
      expect(() =>
        loadAdvocateInvitationEmailCanonicalOrigin(stagingEnvironment),
      ).toThrow("Advocate invitation email worker is unavailable")
    }
    expect(() =>
      loadAdvocateInvitationEmailCanonicalOrigin({
        ...environment,
        ADVOCATE_INVITATION_CANONICAL_ORIGIN:
          "https://advocate-staging.creatorshare.com",
      }),
    ).toThrow("Advocate invitation email worker is unavailable")
    expect(
      isAuthorizedAdvocateInvitationEmailWorkerRequest(
        `Bearer ${SECRET}`,
        SECRET,
      ),
    ).toBe(true)
    expect(
      isAuthorizedAdvocateInvitationEmailWorkerRequest(
        "Bearer wrong-secret-value-with-enough-characters",
        SECRET,
      ),
    ).toBe(false)
  })

  test("reserves claim and platform time at the exact internal budget boundary", () => {
    const boundary = {
      ADVOCATE_INVITATION_EMAIL_BATCH_SIZE: "4",
      ADVOCATE_INVITATION_EMAIL_CONCURRENCY: "4",
      ADVOCATE_INVITATION_EMAIL_SERVICE_REQUEST_TIMEOUT_MILLISECONDS: "9000",
      ADVOCATE_INVITATION_EMAIL_TRANSPORT_TIMEOUT_MILLISECONDS: "30000",
      ADVOCATE_INVITATION_EMAIL_INVOCATION_SAFETY_MARGIN_MILLISECONDS: "2000",
    }
    expect(() => loadAdvocateInvitationEmailWorkerConfig(boundary)).toThrow(
      "Advocate invitation email worker is unavailable",
    )
    expect(
      loadAdvocateInvitationEmailWorkerConfig({
        ...boundary,
        ADVOCATE_INVITATION_EMAIL_INVOCATION_SAFETY_MARGIN_MILLISECONDS: "1999",
      }),
    ).toMatchObject({
      batchSize: 4,
      concurrency: 4,
      serviceRequestTimeoutMilliseconds: 9_000,
      transportTimeoutMilliseconds: 30_000,
      invocationSafetyMarginMilliseconds: 1_999,
    })
    expect(() =>
      loadAdvocateInvitationEmailWorkerConfig({
        ADVOCATE_INVITATION_EMAIL_BATCH_SIZE: "2",
        ADVOCATE_INVITATION_EMAIL_CONCURRENCY: "1",
      }),
    ).toThrow("Advocate invitation email worker is unavailable")
  })

  test("returns aggregate-only route responses and never logs delivery material", async () => {
    const request = new Request(
      "https://creatorshare.com/api/internal/advocates/invitations",
      {
        headers: {
          authorization: `Bearer ${SECRET}`,
          "x-vercel-id": "sfo1::trusted-trace",
          "x-trace-id": "spoofed-trace",
        },
      },
    )
    let capturedContext: unknown = null
    const routeDependencies = {
      environment: {
        ADVOCATE_INVITATION_EMAIL_WORKER_SECRET: SECRET,
        VERCEL: "1",
      },
      now: () => NOW,
      requestId: () => REQUEST_ID,
      workerId: () => WORKER_ID,
      createWorkerDependencies() {
        return dependencies({
          repository: repository({
            async claimJobs(options) {
              capturedContext = options.context
              return []
            },
          }),
        })
      },
    }
    const response =
      await invitationEmailRoute.handleAdvocateInvitationEmailRequest(
        request,
        routeDependencies,
      )
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      requestId: REQUEST_ID,
      claimed: 0,
      sent: 0,
      retried: 0,
      terminalFailed: 0,
      leaseLost: 0,
      manualReview: 0,
      settlementUnknown: 0,
    })
    expect(JSON.stringify(body)).not.toContain(RECIPIENT)
    expect(JSON.stringify(body)).not.toContain(CAPABILITY)
    expect(JSON.stringify(body)).not.toContain(AUTH_TOKEN_HASH)
    expect(capturedContext).toEqual({
      requestId: REQUEST_ID,
      traceId: "sfo1::trusted-trace",
    })

    const unauthorized =
      await invitationEmailRoute.handleAdvocateInvitationEmailRequest(
        new Request(
          "https://creatorshare.com/api/internal/advocates/invitations",
        ),
        routeDependencies,
      )
    expect(unauthorized.status).toBe(401)
    expect(await unauthorized.json()).toMatchObject({
      ok: false,
      code: "unauthorized",
      claimed: 0,
    })
  })

  test("declares and schedules the 120 second Node worker route", async () => {
    expect(ADVOCATE_INVITATION_EMAIL_INVOCATION_BUDGET_MILLISECONDS).toBe(
      110_000,
    )
    const source = await readFile(
      resolve(
        process.cwd(),
        "src/app/api/internal/advocates/invitations/route.ts",
      ),
      "utf8",
    )
    expect(source).toContain('export const runtime = "nodejs"')
    expect(source).toContain("export const maxDuration = 120")

    const vercel = JSON.parse(
      await readFile(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as {
      functions?: Record<string, unknown>
      crons?: Array<{ path?: unknown; schedule?: unknown }>
    }
    expect(
      vercel.functions?.["src/app/api/internal/advocates/invitations/route.ts"],
    ).toEqual({ maxDuration: 120 })
    expect(
      vercel.crons?.filter(
        (entry) => entry.path === "/api/internal/advocates/invitations",
      ),
    ).toEqual([
      {
        path: "/api/internal/advocates/invitations",
        schedule: "* * * * *",
      },
    ])
  })
})
