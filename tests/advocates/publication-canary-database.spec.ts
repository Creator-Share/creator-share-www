import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"

type DatabaseModule =
  typeof import("../../src/lib/advocates/publicationCanary/database")
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
  resolve(process.cwd(), "tests/advocates/publication-canary-database.spec.ts"),
)
const {
  createPublicationCanaryDeploymentAuthorizationDatabase,
  createPublicationCanaryOperationDatabase,
  createPublicationCanaryWorkerDatabase,
  PublicationCanaryDatabaseError,
} = testRequire(
  resolve(process.cwd(), "src/lib/advocates/publicationCanary/database.ts"),
) as DatabaseModule

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"
const DOMAIN_ID = "22222222-2222-4222-8222-222222222222"
const RUN_ID = "33333333-3333-4333-8333-333333333333"
const START_REQUEST_ID = "44444444-4444-4444-8444-444444444444"
const LEASE_TOKEN = "55555555-5555-4555-8555-555555555555"
const REQUEST_ID = "66666666-6666-4666-8666-666666666666"
const DEPLOYMENT_CAPABILITY_ID = "77777777-7777-4777-8777-777777777777"
const DEPLOYMENT_ID = "dpl_1234567890abcdef"
const REVISION = "a".repeat(40)
const REPORT_SHA256 = "b".repeat(64)
const STARTED_AT = "2026-07-18T18:00:00.000Z"
const COMPLETED_AT = "2026-07-18T18:02:00.000Z"

interface RpcCall {
  name: string
  input: Record<string, unknown>
}

function client(
  responses: Record<string, { data: unknown; error: { code?: string } | null }>,
): { value: SupabaseClient; calls: RpcCall[] } {
  const calls: RpcCall[] = []
  return {
    calls,
    value: {
      async rpc(name: string, input: Record<string, unknown>) {
        calls.push({ name, input })
        return responses[name] ?? { data: null, error: { code: "XX000" } }
      },
    } as unknown as SupabaseClient,
  }
}

function startRow() {
  return {
    run_id: RUN_ID,
    advocate_id: ADVOCATE_ID,
    domain_id: DOMAIN_ID,
    hostname: "hope.creatorshare.com",
    expected_advocate_version: 17,
    deployment_id: DEPLOYMENT_ID,
    revision: REVISION,
    stripe_us_attempt_id: "70000000-0000-4000-8000-000000000001",
    stripe_uk_attempt_id: "70000000-0000-4000-8000-000000000002",
    paypal_attempt_id: "70000000-0000-4000-8000-000000000003",
    started_at: STARTED_AT,
  }
}

function operationSnapshotRow() {
  return {
    operation_id: START_REQUEST_ID,
    run_id: RUN_ID,
    advocate_id: ADVOCATE_ID,
    expected_advocate_version: 17,
    deployment_id: DEPLOYMENT_ID,
    revision: REVISION,
    started_at: STARTED_AT,
    outcome: null,
    failure_code: null,
    report_sha256: null,
    completed_at: null,
    published_advocate_version: null,
    created: true,
  }
}

test.describe("publication canary database authority adapters", () => {
  test("uses one authenticated begin-or-resume RPC for creation and status", async () => {
    const authenticated = client({
      begin_or_resume_advocate_publication_canary: {
        data: [operationSnapshotRow()],
        error: null,
      },
      publish_advocate_portal_from_canary_v2: { data: 18, error: null },
    })
    const service = client({
      mint_advocate_publication_deployment_capability: {
        data: [
          {
            deployment_capability_id: DEPLOYMENT_CAPABILITY_ID,
            expires_at: "2026-07-18T18:03:00.000Z",
          },
        ],
        error: null,
      },
    })
    const deploymentAuthorization =
      createPublicationCanaryDeploymentAuthorizationDatabase(service.value)
    const database = createPublicationCanaryOperationDatabase(
      authenticated.value,
      () => deploymentAuthorization,
    )
    const target = {
      advocateId: ADVOCATE_ID,
      expectedVersion: 17,
      deploymentId: DEPLOYMENT_ID,
      revision: REVISION,
    }

    await expect(
      database.beginOrResume({
        operationId: START_REQUEST_ID,
        traceId: "publication-trace-1",
        adminReason: "Initial advocate publication after release review.",
        clientIp: "203.0.113.9",
        userAgent: "Publication test agent/1.0",
        target,
      }),
    ).resolves.toMatchObject({
      operationId: START_REQUEST_ID,
      runId: RUN_ID,
      created: true,
      outcome: null,
    })
    await expect(
      database.publish({
        operationId: START_REQUEST_ID,
        advocateId: ADVOCATE_ID,
        expectedVersion: 17,
        runId: RUN_ID,
        deploymentId: DEPLOYMENT_ID,
        revision: REVISION,
        reportSha256: REPORT_SHA256,
        adminReason: "Initial advocate publication after release review.",
        requestId: REQUEST_ID,
        traceId: "publication-trace-2",
        clientIp: "203.0.113.9",
        userAgent: "Publication test agent/1.0",
      }),
    ).resolves.toBe(18)

    expect(authenticated.calls).toEqual([
      {
        name: "begin_or_resume_advocate_publication_canary",
        input: {
          target_advocate_id: ADVOCATE_ID,
          target_expected_advocate_version: 17,
          target_operation_id: START_REQUEST_ID,
          target_deployment_id: DEPLOYMENT_ID,
          target_git_revision: REVISION,
          target_trace_id: "publication-trace-1",
          target_admin_reason:
            "Initial advocate publication after release review.",
          target_client_ip: "203.0.113.9",
          target_user_agent: "Publication test agent/1.0",
        },
      },
      {
        name: "publish_advocate_portal_from_canary_v2",
        input: {
          target_advocate_id: ADVOCATE_ID,
          target_expected_advocate_version: 17,
          target_operation_id: START_REQUEST_ID,
          target_canary_run_id: RUN_ID,
          target_deployment_id: DEPLOYMENT_ID,
          target_report_sha256: `\\x${REPORT_SHA256}`,
          target_admin_reason:
            "Initial advocate publication after release review.",
          target_request_id: REQUEST_ID,
          target_trace_id: "publication-trace-2",
          target_deployment_capability_id: DEPLOYMENT_CAPABILITY_ID,
          target_client_ip: "203.0.113.9",
          target_user_agent: "Publication test agent/1.0",
        },
      },
    ])
    expect(service.calls).toEqual([
      {
        name: "mint_advocate_publication_deployment_capability",
        input: {
          target_operation_id: START_REQUEST_ID,
          target_canary_run_id: RUN_ID,
          target_deployment_id: DEPLOYMENT_ID,
          target_git_revision: REVISION,
        },
      },
    ])
    expect(
      authenticated.calls.some(
        (call) => call.name === "get_advocate_publication_canary_execution",
      ),
    ).toBe(false)
  })

  test("forwards absent session transport metadata as exact nulls", async () => {
    const authenticated = client({
      begin_or_resume_advocate_publication_canary: {
        data: [operationSnapshotRow()],
        error: null,
      },
    })
    const database = createPublicationCanaryOperationDatabase(
      authenticated.value,
      () => {
        throw new Error("deployment_authorization_must_not_run")
      },
    )

    await database.beginOrResume({
      operationId: START_REQUEST_ID,
      traceId: "publication-trace-1",
      adminReason: "Initial advocate publication after release review.",
      clientIp: null,
      userAgent: null,
      target: {
        advocateId: ADVOCATE_ID,
        expectedVersion: 17,
        deploymentId: DEPLOYMENT_ID,
        revision: REVISION,
      },
    })

    expect(authenticated.calls[0]?.input).toMatchObject({
      target_client_ip: null,
      target_user_agent: null,
    })
  })

  test("uses service role only for queue claim and lease-fenced completion", async () => {
    const claim = {
      ...startRow(),
      start_request_id: START_REQUEST_ID,
      trace_id: "publication-trace-1",
      admin_reason: "Initial advocate publication after release review.",
      lease_token: LEASE_TOKEN,
      leased_until: "2026-07-18T18:05:00.000Z",
    }
    const service = client({
      claim_next_advocate_publication_canary_execution: {
        data: [claim],
        error: null,
      },
      complete_claimed_advocate_publication_canary: {
        data: [
          {
            run_id: RUN_ID,
            outcome: "succeeded",
            report_sha256: `\\x${REPORT_SHA256}`,
            completed_at: COMPLETED_AT,
          },
        ],
        error: null,
      },
    })
    const database = createPublicationCanaryWorkerDatabase(service.value)

    await expect(
      database.claimNext({
        deploymentId: DEPLOYMENT_ID,
        revision: REVISION,
        leaseSeconds: 300,
      }),
    ).resolves.toMatchObject({ runId: RUN_ID, leaseToken: LEASE_TOKEN })
    await database.completeClaimed({
      runId: RUN_ID,
      canonicalReport: '{"outcome":"succeeded"}',
      reportSha256: REPORT_SHA256,
      outcome: "succeeded",
      failureCode: null,
      completedAt: COMPLETED_AT,
      requestId: REQUEST_ID,
      traceId: "publication-trace-1",
      adminReason: "Initial advocate publication after release review.",
      leaseToken: LEASE_TOKEN,
    })

    expect(service.calls.map((call) => call.name)).toEqual([
      "claim_next_advocate_publication_canary_execution",
      "complete_claimed_advocate_publication_canary",
    ])
    expect(service.calls[0]?.input).toEqual({
      target_deployment_id: DEPLOYMENT_ID,
      target_git_revision: REVISION,
      target_lease_seconds: 300,
    })
    expect(service.calls[1]?.input).toMatchObject({
      target_run_id: RUN_ID,
      target_lease_token: LEASE_TOKEN,
      target_report_sha256: `\\x${REPORT_SHA256}`,
    })
  })

  test("fails closed on malformed rows and preserves the database stage", async () => {
    const service = client({
      claim_next_advocate_publication_canary_execution: {
        data: [{ lease_token: LEASE_TOKEN }],
        error: null,
      },
    })
    const database = createPublicationCanaryWorkerDatabase(service.value)
    const failure = await database
      .claimNext({
        deploymentId: DEPLOYMENT_ID,
        revision: REVISION,
        leaseSeconds: 300,
      })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(PublicationCanaryDatabaseError)
    expect(failure).toMatchObject({ stage: "claim" })

    const authenticated = client({
      begin_or_resume_advocate_publication_canary: {
        data: [{ operation_id: START_REQUEST_ID }],
        error: null,
      },
    })
    const operationDatabase = createPublicationCanaryOperationDatabase(
      authenticated.value,
      () => {
        throw new Error("deployment_authorization_must_not_run")
      },
    )
    const operationFailure = await operationDatabase
      .beginOrResume({
        operationId: START_REQUEST_ID,
        traceId: "publication-trace-1",
        adminReason: "Initial advocate publication after release review.",
        clientIp: null,
        userAgent: null,
        target: {
          advocateId: ADVOCATE_ID,
          expectedVersion: 17,
          deploymentId: DEPLOYMENT_ID,
          revision: REVISION,
        },
      })
      .catch((error: unknown) => error)
    expect(operationFailure).toBeInstanceOf(PublicationCanaryDatabaseError)
    expect(operationFailure).toMatchObject({ stage: "begin_or_resume" })

    const malformedAuthorizationClient = client({
      mint_advocate_publication_deployment_capability: {
        data: [{ deployment_capability_id: "not-a-capability" }],
        error: null,
      },
    })
    const authorizationDatabase =
      createPublicationCanaryDeploymentAuthorizationDatabase(
        malformedAuthorizationClient.value,
      )
    const authorizationFailure = await authorizationDatabase
      .mint({
        operationId: START_REQUEST_ID,
        runId: RUN_ID,
        deploymentId: DEPLOYMENT_ID,
        revision: REVISION,
      })
      .catch((error: unknown) => error)
    expect(authorizationFailure).toBeInstanceOf(PublicationCanaryDatabaseError)
    expect(authorizationFailure).toMatchObject({
      stage: "authorize_deployment",
    })
  })
})
