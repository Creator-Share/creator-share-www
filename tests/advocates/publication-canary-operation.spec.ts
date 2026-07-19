import { expect, test } from "@playwright/test"

import {
  classifyPublicationCanaryDatabaseFailure,
  derivePublicationCanaryCompletionRequestId,
  derivePublicationCanaryPublishRequestId,
  derivePublicationCanaryStartRequestId,
  isPublicationCanaryJsonContentType,
  MAX_PUBLICATION_CANARY_REQUEST_BODY_BYTES,
  parsePublicationCanaryCompletionResult,
  parsePublicationCanaryExecutionResult,
  parsePublicationCanaryOperationInput,
  parsePublicationCanaryPublishResult,
  parsePublicationCanaryStartResult,
  parsePublicationCanaryWorkerClaimResult,
  readBoundedPublicationCanaryBody,
} from "../../src/lib/advocates/publicationCanary/operation"

const ACTOR_ID = "11111111-1111-4111-8111-111111111111"
const ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"
const DOMAIN_ID = "33333333-3333-4333-8333-333333333333"
const OPERATION_ID = "44444444-4444-4444-8444-444444444444"
const RUN_ID = "55555555-5555-4555-8555-555555555555"
const ATTEMPT_IDS = {
  stripeUs: "66666666-6666-4666-8666-666666666666",
  stripeUk: "77777777-7777-4777-8777-777777777777",
  paypal: "88888888-8888-4888-8888-888888888888",
}
const DEPLOYMENT_ID = "dpl_1234567890abcdef"
const REVISION = "a".repeat(40)
const REPORT_SHA256 = "b".repeat(64)
const START_REQUEST_ID = "99999999-9999-4999-8999-999999999999"
const LEASE_TOKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab"
const STARTED_AT = "2026-07-18T18:00:00.123456+00:00"
const COMPLETED_AT = "2026-07-18T18:01:00.000+00:00"
const LEASED_UNTIL = "2026-07-18T18:05:00.000+00:00"

const EXPECTED = Object.freeze({
  advocateId: ADVOCATE_ID,
  expectedVersion: 17,
  deploymentId: DEPLOYMENT_ID,
  revision: REVISION,
})

function startRow() {
  return {
    run_id: RUN_ID,
    advocate_id: ADVOCATE_ID,
    domain_id: DOMAIN_ID,
    hostname: "hope.creatorshare.com",
    expected_advocate_version: 17,
    deployment_id: DEPLOYMENT_ID,
    revision: REVISION,
    stripe_us_attempt_id: ATTEMPT_IDS.stripeUs,
    stripe_uk_attempt_id: ATTEMPT_IDS.stripeUk,
    paypal_attempt_id: ATTEMPT_IDS.paypal,
    started_at: STARTED_AT,
  }
}

test.describe("publication canary operation boundary", () => {
  test("accepts one exact bounded operation request", async () => {
    expect(isPublicationCanaryJsonContentType("application/json")).toBe(true)
    expect(
      isPublicationCanaryJsonContentType("Application/JSON; charset=utf-8"),
    ).toBe(true)
    expect(isPublicationCanaryJsonContentType("application/jsonp")).toBe(false)

    const rawBody = JSON.stringify({
      expectedVersion: 17,
      operationId: OPERATION_ID,
      adminReason: "Initial advocate publication after release review.",
    })
    expect(parsePublicationCanaryOperationInput(rawBody)).toEqual({
      expectedVersion: 17,
      operationId: OPERATION_ID,
      adminReason: "Initial advocate publication after release review.",
    })
    await expect(
      readBoundedPublicationCanaryBody(
        new Request("https://creatorshare.com/api/admin/advocates/id/publish", {
          method: "POST",
          body: rawBody,
        }),
      ),
    ).resolves.toBe(rawBody)

    for (const invalid of [
      "{}",
      "[]",
      JSON.stringify({
        expectedVersion: 0,
        operationId: OPERATION_ID,
        adminReason: "Reason",
      }),
      JSON.stringify({
        expectedVersion: 17,
        operationId: "not-a-v4-uuid",
        adminReason: "Reason",
      }),
      JSON.stringify({
        expectedVersion: 17,
        operationId: OPERATION_ID,
        adminReason: " leading space",
      }),
      JSON.stringify({
        expectedVersion: 17,
        operationId: OPERATION_ID,
        adminReason: "bad\nreason",
      }),
      JSON.stringify({
        expectedVersion: 17,
        operationId: OPERATION_ID,
        adminReason: "Reason",
        hostname: "attacker.example",
      }),
      "x".repeat(MAX_PUBLICATION_CANARY_REQUEST_BODY_BYTES + 1),
    ]) {
      expect(parsePublicationCanaryOperationInput(invalid)).toBeNull()
    }
  })

  test("derives stable actor, target, deployment, and phase bound identities", () => {
    const startInput = {
      actorUserId: ACTOR_ID,
      advocateId: ADVOCATE_ID,
      expectedVersion: 17,
      operationId: OPERATION_ID,
      adminReason: "Initial advocate publication after release review.",
      deploymentId: DEPLOYMENT_ID,
      revision: REVISION,
    }
    const startRequestId = derivePublicationCanaryStartRequestId(startInput)
    expect(startRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(derivePublicationCanaryStartRequestId(startInput)).toBe(
      startRequestId,
    )
    expect(
      derivePublicationCanaryStartRequestId({
        ...startInput,
        expectedVersion: 18,
      }),
    ).not.toBe(startRequestId)
    expect(
      derivePublicationCanaryStartRequestId({
        ...startInput,
        adminReason: "Different administrative reason.",
      }),
    ).not.toBe(startRequestId)
    if (startRequestId === null) throw new Error("Expected start request ID")

    const completionRequestId = derivePublicationCanaryCompletionRequestId({
      startRequestId,
      runId: RUN_ID,
    })
    const publishRequestId = derivePublicationCanaryPublishRequestId({
      startRequestId,
      runId: RUN_ID,
      reportSha256: REPORT_SHA256,
    })
    expect(completionRequestId).not.toBe(startRequestId)
    expect(publishRequestId).not.toBe(startRequestId)
    expect(publishRequestId).not.toBe(completionRequestId)
    expect(
      derivePublicationCanaryPublishRequestId({
        startRequestId,
        runId: RUN_ID,
        reportSha256: "invalid",
      }),
    ).toBeNull()
  })

  test("parses only an exact server-bound start target", () => {
    expect(parsePublicationCanaryStartResult([startRow()], EXPECTED)).toEqual({
      runId: RUN_ID,
      advocateId: ADVOCATE_ID,
      domainId: DOMAIN_ID,
      hostname: "hope.creatorshare.com",
      expectedAdvocateVersion: 17,
      deploymentId: DEPLOYMENT_ID,
      revision: REVISION,
      paymentAttemptIds: ATTEMPT_IDS,
      startedAt: STARTED_AT,
    })

    for (const invalid of [
      [],
      [startRow(), startRow()],
      [{ ...startRow(), hostname: "attacker.example" }],
      [{ ...startRow(), expected_advocate_version: 18 }],
      [{ ...startRow(), deployment_id: "dpl_other12345678" }],
      [{ ...startRow(), paypal_attempt_id: ATTEMPT_IDS.stripeUs }],
      [{ ...startRow(), provider_secret: "must-not-leak" }],
    ]) {
      expect(parsePublicationCanaryStartResult(invalid, EXPECTED)).toBeNull()
    }
  })

  test("distinguishes no execution, incomplete work, and immutable completion", () => {
    expect(parsePublicationCanaryExecutionResult([], EXPECTED)).toBeUndefined()
    expect(
      parsePublicationCanaryExecutionResult(
        [
          {
            ...startRow(),
            outcome: null,
            failure_code: null,
            report_sha256: null,
            completed_at: null,
          },
        ],
        EXPECTED,
      ),
    ).toMatchObject({
      runId: RUN_ID,
      outcome: null,
      failureCode: null,
      reportSha256: null,
    })

    expect(
      parsePublicationCanaryExecutionResult(
        [
          {
            ...startRow(),
            outcome: "succeeded",
            failure_code: null,
            report_sha256: `\\x${REPORT_SHA256}`,
            completed_at: COMPLETED_AT,
          },
        ],
        EXPECTED,
      ),
    ).toMatchObject({
      runId: RUN_ID,
      outcome: "succeeded",
      failureCode: null,
      reportSha256: REPORT_SHA256,
      completedAt: COMPLETED_AT,
    })

    for (const invalid of [
      [
        {
          ...startRow(),
          outcome: null,
          failure_code: null,
          report_sha256: null,
          completed_at: COMPLETED_AT,
        },
      ],
      [
        {
          ...startRow(),
          outcome: "succeeded",
          failure_code: null,
          report_sha256: REPORT_SHA256,
          completed_at: COMPLETED_AT,
        },
      ],
    ]) {
      expect(
        parsePublicationCanaryExecutionResult(invalid, EXPECTED),
      ).toBeNull()
    }
  })

  test("parses only an exact deployment-bound worker lease", () => {
    const row = {
      ...startRow(),
      start_request_id: START_REQUEST_ID,
      trace_id: "publication-trace-1",
      admin_reason: "Initial advocate publication after release review.",
      lease_token: LEASE_TOKEN,
      leased_until: LEASED_UNTIL,
    }
    expect(
      parsePublicationCanaryWorkerClaimResult([row], {
        deploymentId: DEPLOYMENT_ID,
        revision: REVISION,
      }),
    ).toMatchObject({
      runId: RUN_ID,
      startRequestId: START_REQUEST_ID,
      leaseToken: LEASE_TOKEN,
      leasedUntil: LEASED_UNTIL,
      deploymentId: DEPLOYMENT_ID,
      revision: REVISION,
    })
    expect(
      parsePublicationCanaryWorkerClaimResult([], {
        deploymentId: DEPLOYMENT_ID,
        revision: REVISION,
      }),
    ).toBeUndefined()
    for (const invalid of [
      [{ ...row, lease_token: "invalid" }],
      [{ ...row, leased_until: STARTED_AT }],
      [{ ...row, deployment_id: "dpl_other12345678" }],
      [{ ...row, trace_id: "bad\ntrace" }],
      [{ ...row, internal_secret: "must-not-leak" }],
    ]) {
      expect(
        parsePublicationCanaryWorkerClaimResult(invalid, {
          deploymentId: DEPLOYMENT_ID,
          revision: REVISION,
        }),
      ).toBeNull()
    }
  })

  test("binds completion and publication results to exact evidence", () => {
    const completion = [
      {
        run_id: RUN_ID,
        outcome: "succeeded",
        report_sha256: `\\x${REPORT_SHA256}`,
        completed_at: COMPLETED_AT,
      },
    ]
    expect(
      parsePublicationCanaryCompletionResult(completion, {
        runId: RUN_ID,
        reportSha256: REPORT_SHA256,
      }),
    ).toEqual({
      runId: RUN_ID,
      outcome: "succeeded",
      reportSha256: REPORT_SHA256,
      completedAt: COMPLETED_AT,
    })
    expect(
      parsePublicationCanaryCompletionResult(completion, {
        runId: RUN_ID,
        reportSha256: "c".repeat(64),
      }),
    ).toBeNull()
    expect(parsePublicationCanaryPublishResult(18, 17)).toBe(18)
    expect(parsePublicationCanaryPublishResult(19, 17)).toBe(19)
    expect(parsePublicationCanaryPublishResult(17, 17)).toBeNull()
    expect(parsePublicationCanaryPublishResult(20, 17)).toBeNull()
  })

  test("maps database details to a static administrative contract", () => {
    expect(classifyPublicationCanaryDatabaseFailure("22023")).toEqual({
      status: 400,
      code: "invalid_request",
    })
    expect(classifyPublicationCanaryDatabaseFailure("42501")).toEqual({
      status: 403,
      code: "forbidden",
    })
    expect(classifyPublicationCanaryDatabaseFailure("23503")).toEqual({
      status: 404,
      code: "portal_not_found",
    })
    expect(classifyPublicationCanaryDatabaseFailure("40001")).toEqual({
      status: 409,
      code: "publication_conflict",
    })
    expect(classifyPublicationCanaryDatabaseFailure("XX000")).toEqual({
      status: 500,
      code: "publication_failed",
    })
  })
})
