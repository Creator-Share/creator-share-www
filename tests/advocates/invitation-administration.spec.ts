import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  parseAdvocateInvitationIssueInput,
  parseAdvocateInvitationRevokeInput,
  parseAdvocatePendingInvitationApi,
  parseAdvocatePendingInvitations,
} from "../../src/lib/advocates/invitations/administrationContracts"

type AdministrationModule =
  typeof import("../../src/lib/advocates/invitations/administration")
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
  resolve(process.cwd(), "tests/advocates/invitation-administration.spec.ts"),
)
const administration = testRequire(
  "../../src/lib/advocates/invitations/administration",
) as AdministrationModule
nodeModule._load = originalModuleLoad

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"
const ACTOR_ID = "22222222-2222-4222-8222-222222222222"
const INVITATION_ID = "33333333-3333-4333-8333-333333333333"
const OUTBOX_ID = "44444444-4444-4444-8444-444444444444"

const PENDING_ROW = Object.freeze({
  invitation_id: INVITATION_ID,
  invited_email: "delegate@example.com",
  role_keys: ["analytics_viewer", "brand_editor"],
  invitation_status: "pending",
  expires_at: "2026-07-25T12:00:00+00:00",
  created_at: "2026-07-18T12:00:00+00:00",
  created_by_current_user: true,
})

const API_INVITATION = Object.freeze({
  invitationId: INVITATION_ID,
  invitedEmail: "delegate@example.com",
  roleKeys: ["analytics_viewer", "brand_editor"],
  status: "pending",
  expiresAt: "2026-07-25T12:00:00+00:00",
  createdAt: "2026-07-18T12:00:00+00:00",
  createdByCurrentUser: true,
})

test.describe("advocate invitation administration contracts", () => {
  test("accepts only the privacy-limited pending projection", () => {
    expect(parseAdvocatePendingInvitations([PENDING_ROW])).toEqual([
      API_INVITATION,
    ])
    expect(parseAdvocatePendingInvitationApi(API_INVITATION)).toEqual(
      API_INVITATION,
    )
    expect(
      Object.isFrozen(parseAdvocatePendingInvitations([PENDING_ROW])),
    ).toBe(true)

    for (const row of [
      { ...PENDING_ROW, auth_user_id: ACTOR_ID },
      { ...PENDING_ROW, capability: "a".repeat(64) },
      { ...PENDING_ROW, provider_message_id: "provider-secret" },
      { ...PENDING_ROW, invited_email: "Delegate@example.com" },
      { ...PENDING_ROW, role_keys: ["brand_editor", "analytics_viewer"] },
      { ...PENDING_ROW, role_keys: ["owner"] },
      { ...PENDING_ROW, invitation_status: "sent" },
      { ...PENDING_ROW, expires_at: PENDING_ROW.created_at },
    ]) {
      expect(parseAdvocatePendingInvitations([row])).toBeNull()
    }
    expect(
      parseAdvocatePendingInvitations([PENDING_ROW, PENDING_ROW]),
    ).toBeNull()
    expect(JSON.stringify(API_INVITATION)).not.toMatch(
      /auth_user|capability|ciphertext|digest|provider|outbox/i,
    )
  })

  test("normalizes role order and rejects malformed invitation mutations", () => {
    const issue = {
      email: "Delegate@Example.com",
      roleKeys: ["brand_editor", "analytics_viewer"],
      reason: "Provide reporting and brand access.",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    }
    expect(parseAdvocateInvitationIssueInput(JSON.stringify(issue))).toEqual({
      ...issue,
      roleKeys: ["analytics_viewer", "brand_editor"],
    })
    expect(
      parseAdvocateInvitationRevokeInput(
        JSON.stringify({ reason: "Access is no longer required." }),
      ),
    ).toEqual({ reason: "Access is no longer required." })

    for (const value of [
      {},
      { ...issue, extra: true },
      { ...issue, email: "invalid" },
      { ...issue, roleKeys: [] },
      { ...issue, roleKeys: ["owner"] },
      { ...issue, roleKeys: ["brand_editor", "brand_editor"] },
      { ...issue, reason: " padded " },
      { ...issue, idempotencyKey: "not-a-uuid" },
    ]) {
      expect(
        parseAdvocateInvitationIssueInput(JSON.stringify(value)),
      ).toBeNull()
    }
    expect(
      parseAdvocateInvitationRevokeInput(JSON.stringify({ reason: "" })),
    ).toBeNull()
    expect(
      parseAdvocateInvitationIssueInput(
        JSON.stringify({ ...issue, reason: "x".repeat(8_300) }),
      ),
    ).toBeNull()
  })
})

test.describe("advocate invitation encrypted delivery preparation", () => {
  test("creates a 256 bit capability, hashes its plaintext, and encrypts only canonical material", () => {
    const calls: Array<{ name: string; value: string }> = []
    const crypto = {
      digestEmail(value: string) {
        calls.push({ name: "digestEmail", value })
        return {
          normalizedEmail: "delegate@example.com",
          normalizationVersion: 1,
          hmacKeyVersion: 1,
          digestRpcBytea: `\\x${"22".repeat(32)}`,
        }
      },
      encryptRecipientEmail(value: string) {
        calls.push({ name: "encryptRecipientEmail", value })
        return {
          encryptionKeyVersion: 1,
          ciphertextRpcBytea: `\\x${"33".repeat(32)}`,
        }
      },
      encryptSecretPayload(value: string) {
        calls.push({ name: "encryptSecretPayload", value })
        return {
          encryptionKeyVersion: 1,
          ciphertextRpcBytea: `\\x${"44".repeat(32)}`,
        }
      },
    }
    const prepared = administration.prepareAdvocateInvitationDelivery(
      "Delegate@Example.com",
      {
        crypto: crypto as never,
        randomBytes: (size) => new Uint8Array(size).fill(0xab),
      },
    )

    const capability = "ab".repeat(32)
    expect(prepared).toEqual({
      capability,
      capabilityDigest: `\\x${createHash("sha256").update(capability).digest("hex")}`,
      normalizedEmail: "delegate@example.com",
      recipientEmailCiphertext: `\\x${"33".repeat(32)}`,
      recipientEmailHmac: `\\x${"22".repeat(32)}`,
      secretPayloadCiphertext: `\\x${"44".repeat(32)}`,
      emailNormalizationVersion: 1,
      emailHmacKeyVersion: 1,
      emailEncryptionKeyVersion: 1,
    })
    expect(calls).toEqual([
      { name: "digestEmail", value: "Delegate@Example.com" },
      { name: "encryptRecipientEmail", value: "delegate@example.com" },
      {
        name: "encryptSecretPayload",
        value: JSON.stringify({ version: 1, capability }),
      },
    ])
    expect(JSON.stringify(prepared)).not.toContain("Delegate@Example.com")
  })

  test("uses exact purpose-built RPCs and never returns delivery secrets", async () => {
    const authCalls: Array<{ name: string; args: unknown }> = []
    const serviceCalls: Array<{ name: string; args: unknown }> = []
    const authenticatedClient = {
      async rpc(name: string, args: unknown) {
        authCalls.push({ name, args })
        return { data: [PENDING_ROW], error: null }
      },
    }
    const serviceClient = {
      async rpc(name: string, args: unknown) {
        serviceCalls.push({ name, args })
        if (name === "issue_advocate_invitation_email") {
          return {
            data: [
              {
                invitation_id: INVITATION_ID,
                outbox_id: OUTBOX_ID,
                expires_at: PENDING_ROW.expires_at,
                created: true,
              },
            ],
            error: null,
          }
        }
        return { data: true, error: null }
      },
    }
    const repository = administration.createAdvocateInvitationRepository({
      authenticatedClient: authenticatedClient as never,
      serviceClient: serviceClient as never,
    })
    const context = {
      requestId: "request-1",
      traceId: "trace-1",
      sessionId: null,
      clientIp: "192.0.2.1",
      userAgent: "test-agent",
    }
    const invitation = {
      email: "delegate@example.com",
      roleKeys: ["analytics_viewer"] as const,
      reason: "Grant reporting access.",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    }
    const delivery = {
      capability: "aa".repeat(32),
      capabilityDigest: `\\x${"11".repeat(32)}` as const,
      normalizedEmail: "delegate@example.com",
      recipientEmailCiphertext: `\\x${"22".repeat(32)}` as const,
      recipientEmailHmac: `\\x${"33".repeat(32)}` as const,
      secretPayloadCiphertext: `\\x${"44".repeat(32)}` as const,
      emailNormalizationVersion: 1,
      emailHmacKeyVersion: 1,
      emailEncryptionKeyVersion: 1,
    }

    const issued = await repository.issue({
      advocateId: ADVOCATE_ID,
      actingUserId: ACTOR_ID,
      invitation,
      context,
      delivery,
    })
    expect(issued).toEqual({
      invitationId: INVITATION_ID,
      expiresAt: PENDING_ROW.expires_at,
      created: true,
    })
    expect(JSON.stringify(issued)).not.toMatch(
      /capability|outbox|ciphertext|digest|email/i,
    )
    expect(serviceCalls[0]).toEqual({
      name: "issue_advocate_invitation_email",
      args: expect.objectContaining({
        target_advocate_id: ADVOCATE_ID,
        acting_user_id: ACTOR_ID,
        invited_email: "delegate@example.com",
        role_keys: ["analytics_viewer"],
        idempotency_key: invitation.idempotencyKey,
        capability_digest: delivery.capabilityDigest,
        recipient_email_ciphertext: delivery.recipientEmailCiphertext,
        recipient_email_hmac: delivery.recipientEmailHmac,
        secret_payload_ciphertext: delivery.secretPayloadCiphertext,
        change_reason: invitation.reason,
        request_id: context.requestId,
        trace_id: context.traceId,
        client_ip: context.clientIp,
        user_agent: context.userAgent,
      }),
    })

    expect(await repository.loadPending(ADVOCATE_ID)).toEqual([API_INVITATION])
    expect(authCalls).toEqual([
      {
        name: "get_advocate_pending_invitations",
        args: { target_advocate_id: ADVOCATE_ID },
      },
    ])

    expect(
      await repository.revoke({
        advocateId: ADVOCATE_ID,
        invitationId: INVITATION_ID,
        actingUserId: ACTOR_ID,
        reason: "Access is no longer needed.",
        context,
      }),
    ).toBe(true)
    expect(serviceCalls[1]).toEqual({
      name: "revoke_advocate_invitation",
      args: expect.objectContaining({
        target_advocate_id: ADVOCATE_ID,
        target_invitation_id: INVITATION_ID,
        acting_user_id: ACTOR_ID,
        change_reason: "Access is no longer needed.",
      }),
    })
  })
})
