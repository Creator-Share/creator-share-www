import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import Module from "node:module"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"

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
const {
  AdvocateInvitationAuthProviderError,
  createSupabaseAdvocateInvitationAuthProvider,
} = testRequire(
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
const { createNodemailerAdvocateInvitationEmailTransport } = testRequire(
  "../../src/lib/advocates/invitations/emailTransport",
) as typeof import("../../src/lib/advocates/invitations/emailTransport")
const {
  AdvocateInvitationEmailRepositoryError,
  AdvocateInvitationEmailTransportError,
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
      async generateMagicLink() {
        return {
          userId: USER_ID,
          hashedToken: AUTH_TOKEN_HASH,
          authType: "magiclink",
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
  test("uses admin magiclink generation with explicit create-if-missing semantics", async () => {
    const calls: unknown[] = []
    const provider = createSupabaseAdvocateInvitationAuthProvider({
      auth: {
        admin: {
          async generateLink(input: unknown) {
            calls.push(input)
            return {
              data: {
                user: { id: USER_ID, email: RECIPIENT },
                properties: {
                  verification_type: "magiclink",
                  hashed_token: AUTH_TOKEN_HASH,
                },
              },
              error: null,
            }
          },
        },
      },
    } as unknown as SupabaseClient)
    await expect(
      provider.generateMagicLink({
        recipientEmail: RECIPIENT,
        redirectTo: "https://creatorshare.com/advocate-invitation",
        createUserIfMissing: true,
      }),
    ).resolves.toEqual({
      userId: USER_ID,
      hashedToken: AUTH_TOKEN_HASH,
      authType: "magiclink",
    })
    expect(calls).toEqual([
      {
        type: "magiclink",
        email: RECIPIENT,
        options: {
          redirectTo: "https://creatorshare.com/advocate-invitation",
        },
      },
    ])
  })

  test("preserves the provider signup proof for a newly created account", async () => {
    const provider = createSupabaseAdvocateInvitationAuthProvider({
      auth: {
        admin: {
          async generateLink() {
            return {
              data: {
                user: { id: USER_ID, email: RECIPIENT },
                properties: {
                  verification_type: "signup",
                  hashed_token: AUTH_TOKEN_HASH,
                },
              },
              error: null,
            }
          },
        },
      },
    } as unknown as SupabaseClient)

    await expect(
      provider.generateMagicLink({
        recipientEmail: RECIPIENT,
        redirectTo: "https://creatorshare.com/advocate-invitation",
        createUserIfMissing: true,
      }),
    ).resolves.toEqual({
      userId: USER_ID,
      hashedToken: AUTH_TOKEN_HASH,
      authType: "signup",
    })
  })

  test("rejects an unrelated provider verification type", async () => {
    const provider = createSupabaseAdvocateInvitationAuthProvider({
      auth: {
        admin: {
          async generateLink() {
            return {
              data: {
                user: { id: USER_ID, email: RECIPIENT },
                properties: {
                  verification_type: "recovery",
                  hashed_token: AUTH_TOKEN_HASH,
                },
              },
              error: null,
            }
          },
        },
      },
    } as unknown as SupabaseClient)

    await expect(
      provider.generateMagicLink({
        recipientEmail: RECIPIENT,
        redirectTo: "https://creatorshare.com/advocate-invitation",
        createUserIfMissing: true,
      }),
    ).rejects.toMatchObject({ targetUnavailable: true })
  })

  test("rejects a provider response for a different account email", async () => {
    const provider = createSupabaseAdvocateInvitationAuthProvider({
      auth: {
        admin: {
          async generateLink() {
            return {
              data: {
                user: { id: USER_ID, email: "other@example.test" },
                properties: {
                  verification_type: "magiclink",
                  hashed_token: AUTH_TOKEN_HASH,
                },
              },
              error: null,
            }
          },
        },
      },
    } as unknown as SupabaseClient)
    await expect(
      provider.generateMagicLink({
        recipientEmail: RECIPIENT,
        redirectTo: "https://creatorshare.com/advocate-invitation",
        createUserIfMissing: true,
      }),
    ).rejects.toMatchObject({ targetUnavailable: true })
  })

  test("maps the dedicated claim, bind, begin, settle, and fail RPCs exactly", async () => {
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
      "bind_advocate_invitation_email_target",
      "begin_advocate_invitation_email_delivery",
      "settle_advocate_invitation_email_delivery",
      "fail_advocate_invitation_email_delivery",
    ])
    expect(calls[1].args).toMatchObject({
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
      invocationDeadlineAt: NOW + 60_000,
      dependencies: dependencies({
        authProvider: {
          async generateMagicLink(options) {
            stages.push("auth")
            expect(options.createUserIfMissing).toBe(true)
            return {
              userId: USER_ID,
              hashedToken: AUTH_TOKEN_HASH,
              authType: "signup",
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
      invocationDeadlineAt: NOW + 60_000,
      dependencies: dependencies({
        authProvider: {
          async generateMagicLink() {
            stages.push("auth")
            return {
              userId: USER_ID,
              hashedToken: AUTH_TOKEN_HASH,
              authType: "magiclink",
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
      invocationDeadlineAt: NOW + 60_000,
      dependencies: dependencies({
        authProvider: {
          async generateMagicLink() {
            authCalled = true
            return {
              userId: USER_ID,
              hashedToken: AUTH_TOKEN_HASH,
              authType: "magiclink",
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

  test("retries a short-lived auth generation failure before handoff", async () => {
    let failureCode: string | null = null
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob(),
      context,
      invocationDeadlineAt: NOW + 60_000,
      dependencies: dependencies({
        authProvider: {
          async generateMagicLink() {
            throw new AdvocateInvitationAuthProviderError()
          },
        },
        repository: repository({
          async failDelivery(options) {
            failureCode = options.errorCode
            return { retryable: true }
          },
        }),
      }),
    })
    expect(result.status).toBe("retried")
    expect(failureCode).toBe("auth_link_generation_failed")
  })

  test("classifies an exact bound-account mismatch as target unavailable", async () => {
    let failureCode: string | null = null
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob({
        targetAuthUserId: "77777777-7777-4777-8777-777777777777",
      }),
      context,
      invocationDeadlineAt: NOW + 60_000,
      dependencies: dependencies({
        repository: repository({
          async failDelivery(options) {
            failureCode = options.errorCode
            return { retryable: true }
          },
        }),
      }),
    })
    expect(result.status).toBe("retried")
    expect(failureCode).toBe("invitation_target_unavailable")
  })

  test("settles a provider-confirmed rejection as retryable", async () => {
    let settlement: Record<string, unknown> | null = null
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob(),
      context,
      invocationDeadlineAt: NOW + 60_000,
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
      invocationDeadlineAt: NOW + 60_000,
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
      invocationDeadlineAt: NOW + 60_000,
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
      invocationDeadlineAt: NOW + 60_000,
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
      invocationDeadlineAt: NOW + 60_000,
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

  test("fails safely before auth when invocation headroom is insufficient", async () => {
    let authCalled = false
    let failureCode: string | null = null
    const result = await processAdvocateInvitationEmail({
      config,
      job: claimedJob(),
      context,
      invocationDeadlineAt: NOW + 30_000,
      dependencies: dependencies({
        authProvider: {
          async generateMagicLink() {
            authCalled = true
            return {
              userId: USER_ID,
              hashedToken: AUTH_TOKEN_HASH,
              authType: "magiclink",
            }
          },
        },
        repository: repository({
          async failDelivery(options) {
            failureCode = options.errorCode
            return { retryable: true }
          },
        }),
      }),
    })
    expect(result.status).toBe("retried")
    expect(failureCode).toBe("internal_error")
    expect(authCalled).toBe(false)
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
      invocationDeadlineAt: NOW + 60_000,
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

  test("returns aggregate-only route responses and never logs delivery material", async () => {
    const request = new Request(
      "https://creatorshare.com/api/internal/advocates/invitations",
      {
        headers: {
          authorization: `Bearer ${SECRET}`,
          "x-trace-id": "trace-reference",
        },
      },
    )
    const routeDependencies = {
      environment: {
        ADVOCATE_INVITATION_EMAIL_WORKER_SECRET: SECRET,
      },
      now: () => NOW,
      requestId: () => REQUEST_ID,
      workerId: () => WORKER_ID,
      createWorkerDependencies() {
        return dependencies({
          repository: repository({
            async claimJobs() {
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

  test("declares and schedules the sixty second Node worker route", async () => {
    const source = await readFile(
      resolve(
        process.cwd(),
        "src/app/api/internal/advocates/invitations/route.ts",
      ),
      "utf8",
    )
    expect(source).toContain('export const runtime = "nodejs"')
    expect(source).toContain("export const maxDuration = 60")

    const vercel = JSON.parse(
      await readFile(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as {
      functions?: Record<string, unknown>
      crons?: Array<{ path?: unknown; schedule?: unknown }>
    }
    expect(
      vercel.functions?.["src/app/api/internal/advocates/invitations/route.ts"],
    ).toEqual({ maxDuration: 60 })
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
