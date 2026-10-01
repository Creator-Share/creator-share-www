import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  MAX_CREATOR_SHARE_INITIAL_OWNER_REISSUE_BODY_BYTES,
  parseCreatorShareInitialOwnerReissueRequest,
  parseCreatorShareInitialOwnerReissueResponse,
  readBoundedCreatorShareInitialOwnerReissueBody,
} from "../../src/lib/advocates/creatorShareAdmin/initialOwnerRecoveryContracts"

type RecoveryModule =
  typeof import("../../src/lib/advocates/creatorShareAdmin/initialOwnerRecovery")
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
    "tests/advocates/creator-share-initial-owner-recovery.spec.ts",
  ),
)
const recovery = testRequire(
  "../../src/lib/advocates/creatorShareAdmin/initialOwnerRecovery",
) as RecoveryModule
nodeModule._load = originalModuleLoad

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"
const OPERATION_ID = "22222222-2222-4222-8222-222222222222"

const REQUEST = Object.freeze({
  expectedVersion: 3,
  ownerEmail: "Owner@Example.com",
  reason: "The prior invitation expired before the owner could accept it.",
  operationId: OPERATION_ID,
  confirmation: "REISSUE_INITIAL_OWNER" as const,
})

const DELIVERY = Object.freeze({
  capability: "a".repeat(64),
  capabilityDigest: `\\x${"b".repeat(64)}` as const,
  normalizedEmail: "owner@example.com",
  recipientEmailCiphertext: `\\x${"c".repeat(80)}` as const,
  recipientEmailHmac: `\\x${"d".repeat(64)}` as const,
  secretPayloadCiphertext: `\\x${"e".repeat(96)}` as const,
  emailNormalizationVersion: 1,
  emailHmacKeyVersion: 1,
  emailEncryptionKeyVersion: 1,
})

test.describe("Creator Share initial owner recovery contracts", () => {
  test("accepts only the exact versioned privacy-bounded request", () => {
    expect(
      parseCreatorShareInitialOwnerReissueRequest(JSON.stringify(REQUEST)),
    ).toEqual(REQUEST)

    for (const invalid of [
      { ...REQUEST, expectedVersion: 0 },
      { ...REQUEST, ownerEmail: "owner@localhost" },
      { ...REQUEST, reason: " padded " },
      {
        ...REQUEST,
        operationId: "11111111-1111-1111-8111-111111111111",
      },
      { ...REQUEST, reason: "Line one\nLine two" },
      { ...REQUEST, confirmation: "REISSUE" },
      { ...REQUEST, invitationId: ADVOCATE_ID },
      { ...REQUEST, provider: "resend" },
    ]) {
      expect(
        parseCreatorShareInitialOwnerReissueRequest(JSON.stringify(invalid)),
      ).toBeNull()
    }
  })

  test("accepts only sanitized immutable response evidence", () => {
    const expected = {
      operationId: OPERATION_ID,
      advocateId: ADVOCATE_ID,
      expectedVersion: 3,
    }
    const success = {
      ok: true,
      operationId: OPERATION_ID,
      advocateId: ADVOCATE_ID,
      advocateVersion: 4,
      reissueStatus: "initial_owner_invitation_requeued",
    }
    expect(
      parseCreatorShareInitialOwnerReissueResponse(success, expected),
    ).toEqual(success)
    for (const invalid of [
      { ...success, advocateVersion: 3 },
      { ...success, reissueStatus: "sent" },
      { ...success, invitationId: ADVOCATE_ID },
      { ...success, ownerEmail: "owner@example.com" },
      { ...success, providerMessageId: "private" },
    ]) {
      expect(
        parseCreatorShareInitialOwnerReissueResponse(invalid, expected),
      ).toBeNull()
    }
  })

  test("bounds body bytes and rejects invalid UTF-8", async () => {
    await expect(
      readBoundedCreatorShareInitialOwnerReissueBody(
        new Request("https://creatorshare.com/reissue", {
          method: "POST",
          body: JSON.stringify(REQUEST),
        }),
      ),
    ).resolves.toBe(JSON.stringify(REQUEST))
    await expect(
      readBoundedCreatorShareInitialOwnerReissueBody(
        new Request("https://creatorshare.com/reissue", {
          method: "POST",
          body: "x".repeat(
            MAX_CREATOR_SHARE_INITIAL_OWNER_REISSUE_BODY_BYTES + 1,
          ),
        }),
      ),
    ).resolves.toBeNull()
    await expect(
      readBoundedCreatorShareInitialOwnerReissueBody(
        new Request("https://creatorshare.com/reissue", {
          method: "POST",
          body: Uint8Array.from([0xc3, 0x28]),
        }),
      ),
    ).resolves.toBeNull()
  })
})

test.describe("Creator Share initial owner recovery repository", () => {
  test("seals contact and capability material only on the server", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const repository = recovery.createCreatorShareInitialOwnerReissueRepository(
      {
        async rpc(name: string, args: Record<string, unknown>) {
          calls.push({ name, args })
          return {
            data: [
              {
                operation_id: OPERATION_ID,
                advocate_id: ADVOCATE_ID,
                advocate_version: 4,
                onboarding_status: "initial_owner_invitation_requeued",
                created: true,
              },
            ],
            error: null,
          }
        },
      } as never,
      {
        prepareInvitationDelivery(email) {
          expect(email).toBe("owner@example.com")
          return DELIVERY
        },
      },
    )

    await expect(
      repository.reissue({
        advocateId: ADVOCATE_ID,
        expectedVersion: 3,
        ownerEmail: "Owner@Example.com",
        reason: REQUEST.reason,
        operationId: OPERATION_ID,
        context: {
          traceId: "trace-123",
          sessionId: null,
          clientIp: "203.0.113.42",
          userAgent: "Creator Share Admin Test/1.0",
        },
      }),
    ).resolves.toEqual({
      operationId: OPERATION_ID,
      advocateId: ADVOCATE_ID,
      advocateVersion: 4,
      reissueStatus: "initial_owner_invitation_requeued",
      created: true,
    })

    expect(calls).toEqual([
      {
        name: "reissue_advocate_initial_owner_invitation",
        args: {
          reissue_operation_id: OPERATION_ID,
          target_advocate_id: ADVOCATE_ID,
          expected_advocate_version: 3,
          owner_email: "owner@example.com",
          capability_digest: DELIVERY.capabilityDigest,
          recipient_email_ciphertext: DELIVERY.recipientEmailCiphertext,
          recipient_email_hmac: DELIVERY.recipientEmailHmac,
          secret_payload_ciphertext: DELIVERY.secretPayloadCiphertext,
          email_normalization_version: 1,
          email_hmac_key_version: 1,
          email_encryption_key_version: 1,
          change_reason: REQUEST.reason,
          request_id: OPERATION_ID,
          trace_id: "trace-123",
          session_id: null,
          client_ip: "203.0.113.42",
          user_agent: "Creator Share Admin Test/1.0",
        },
      },
    ])
    expect(calls[0].args).not.toHaveProperty("capability")
  })

  test("rejects malformed RPC output and maps only static failures", async () => {
    const malformed = recovery.createCreatorShareInitialOwnerReissueRepository(
      {
        async rpc() {
          return {
            data: [
              {
                operation_id: OPERATION_ID,
                advocate_id: ADVOCATE_ID,
                advocate_version: 4,
                onboarding_status: "initial_owner_invitation_requeued",
                created: true,
                invitation_id: ADVOCATE_ID,
              },
            ],
            error: null,
          }
        },
      } as never,
      { prepareInvitationDelivery: () => DELIVERY },
    )
    await expect(
      malformed.reissue({
        advocateId: ADVOCATE_ID,
        expectedVersion: 3,
        ownerEmail: "owner@example.com",
        reason: REQUEST.reason,
        operationId: OPERATION_ID,
        context: {
          traceId: "trace-123",
          sessionId: null,
          clientIp: null,
          userAgent: null,
        },
      }),
    ).rejects.toMatchObject({ stage: "shape" })

    expect(
      recovery.classifyCreatorShareInitialOwnerReissueFailure("42501"),
    ).toEqual({ status: 403, code: "forbidden" })
    expect(
      recovery.classifyCreatorShareInitialOwnerReissueFailure("55000"),
    ).toEqual({ status: 409, code: "initial_owner_reissue_conflict" })
    expect(
      recovery.classifyCreatorShareInitialOwnerReissueFailure("XX000"),
    ).toEqual({ status: 503, code: "initial_owner_reissue_unavailable" })
  })
})
