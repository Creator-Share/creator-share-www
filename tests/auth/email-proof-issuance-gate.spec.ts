import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type GateModule = typeof import("../../src/lib/auth/emailProofIssuanceGate")
type GateInput =
  import("../../src/lib/auth/emailProofIssuanceGate").EmailProofIssuanceGateInput
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
  resolve(process.cwd(), "tests/auth/email-proof-issuance-gate.spec.ts"),
)
const gate = testRequire(
  "../../src/lib/auth/emailProofIssuanceGate",
) as GateModule
nodeModule._load = originalModuleLoad

const RECIPIENT_DIGEST = `\\x${"11".repeat(32)}` as const
const LEASE_TOKEN = `\\x${"22".repeat(32)}` as const
const OPERATION_ID = "11111111-1111-4111-8111-111111111111"
const REQUEST_ID = "22222222-2222-4222-8222-222222222222"

function validInput(): GateInput {
  return {
    recipientDigest: RECIPIENT_DIGEST,
    recipientNormalizationVersion: 1,
    recipientHmacKeyVersion: 1,
    flow: "generic-sign-in",
    operationId: OPERATION_ID,
    leaseToken: LEASE_TOKEN,
    context: { requestId: REQUEST_ID, traceId: "sfo1::proof-trace" },
  }
}

type RpcCall = { name: string; args: Record<string, unknown> }

function fakeClient(
  responder: (
    name: string,
    args: Record<string, unknown>,
    index: number,
  ) => unknown | Promise<unknown>,
): { client: never; calls: RpcCall[] } {
  const calls: RpcCall[] = []
  return {
    calls,
    client: {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args })
        return responder(name, args, calls.length - 1)
      },
    } as never,
  }
}

function expectedBaseArguments() {
  return {
    target_recipient_digest: RECIPIENT_DIGEST,
    target_recipient_normalization_version: 1,
    target_recipient_hmac_key_version: 1,
    target_issuance_flow: "generic-sign-in",
    target_operation_id: OPERATION_ID,
    target_lease_token: LEASE_TOKEN,
    context_request_id: REQUEST_ID,
    context_trace_id: "sfo1::proof-trace",
  }
}

test("maps every state transition to its exact RPC contract", async () => {
  const { client, calls } = fakeClient((name) => ({
    data:
      name === "acquire_email_proof_issuance_gate"
        ? [{ acquisition_result: "acquired", retry_after_seconds: 0 }]
        : null,
    error: null,
  }))
  const repository = gate.createEmailProofIssuanceGateRepository(client)
  const input = validInput()

  await expect(repository.acquire(input)).resolves.toEqual({
    status: "acquired",
    retryAfterSeconds: 0,
  })
  await repository.begin(input)
  await repository.finish(input, "issued")
  await repository.abandon(input)

  expect(calls).toEqual([
    {
      name: "acquire_email_proof_issuance_gate",
      args: expectedBaseArguments(),
    },
    { name: "begin_email_proof_issuance", args: expectedBaseArguments() },
    {
      name: "finish_email_proof_issuance",
      args: {
        ...expectedBaseArguments(),
        target_finish_disposition: "issued",
      },
    },
    { name: "abandon_email_proof_issuance", args: expectedBaseArguments() },
  ])
})

test("accepts only one exact acquisition row", async () => {
  for (const [data, expected] of [
    [
      [{ acquisition_result: "coalesced", retry_after_seconds: 0 }],
      { status: "coalesced", retryAfterSeconds: 0 },
    ],
    [
      [{ acquisition_result: "deferred", retry_after_seconds: 3900 }],
      { status: "deferred", retryAfterSeconds: 3900 },
    ],
  ] as const) {
    const { client } = fakeClient(() => ({ data, error: null }))
    await expect(
      gate.createEmailProofIssuanceGateRepository(client).acquire(validInput()),
    ).resolves.toEqual(expected)
  }

  for (const data of [
    null,
    { acquisition_result: "acquired", retry_after_seconds: 0 },
    [],
    [
      { acquisition_result: "acquired", retry_after_seconds: 0 },
      { acquisition_result: "acquired", retry_after_seconds: 0 },
    ],
    [{ acquisition_result: "acquired" }],
    [
      {
        acquisition_result: "acquired",
        retry_after_seconds: 0,
        recipient: "leak",
      },
    ],
    [{ acquisition_result: "unknown", retry_after_seconds: 0 }],
    [{ acquisition_result: "acquired", retry_after_seconds: 1 }],
    [{ acquisition_result: "deferred", retry_after_seconds: 0 }],
    [{ acquisition_result: "coalesced", retry_after_seconds: -1 }],
    [{ acquisition_result: "coalesced", retry_after_seconds: 3901 }],
    [{ acquisition_result: "coalesced", retry_after_seconds: "1" }],
  ]) {
    const { client } = fakeClient(() => ({ data, error: null }))
    await expect(
      gate.createEmailProofIssuanceGateRepository(client).acquire(validInput()),
    ).rejects.toMatchObject({
      name: "EmailProofIssuanceGateError",
      stage: "acquire",
      transportFailure: false,
    })
  }
})

test("rejects malformed void responses and reports the real transition stage", async () => {
  for (const [method, stage] of [
    ["begin", "begin"],
    ["finish", "finish"],
    ["abandon", "abandon"],
  ] as const) {
    const { client } = fakeClient(() => ({ data: true, error: null }))
    const repository = gate.createEmailProofIssuanceGateRepository(client)
    const invocation =
      method === "finish"
        ? repository.finish(validInput(), "ambiguous")
        : repository[method](validInput())
    await expect(invocation).rejects.toMatchObject({ stage })
  }

  for (const [method, stage] of [
    ["acquire", "acquire"],
    ["begin", "begin"],
    ["finish", "finish"],
    ["abandon", "abandon"],
  ] as const) {
    const { client } = fakeClient(() => ({ data: null, error: null }))
    const repository = gate.createEmailProofIssuanceGateRepository(client)
    const invalid = {
      ...validInput(),
      leaseToken: `\\x${"33".repeat(31)}`,
    } as GateInput
    const invocation =
      method === "finish"
        ? repository.finish(invalid, "issued")
        : repository[method](invalid)
    await expect(invocation).rejects.toMatchObject({ stage })
  }
})

test("classifies transport failures without misclassifying database failures", async () => {
  for (const response of [
    new TypeError("fetch failed"),
    { data: null, error: { code: "", message: "network unavailable" } },
  ]) {
    const { client } = fakeClient(() => {
      if (response instanceof Error) throw response
      return response
    })
    await expect(
      gate.createEmailProofIssuanceGateRepository(client).acquire(validInput()),
    ).rejects.toMatchObject({
      stage: "acquire",
      transportFailure: true,
    })
  }

  for (const error of [
    { code: "55000", message: "stale" },
    { code: "PGRST116", message: "cardinality" },
    { code: "", message: "provider rejected input" },
  ]) {
    const { client } = fakeClient(() => ({ data: null, error }))
    await expect(
      gate.createEmailProofIssuanceGateRepository(client).acquire(validInput()),
    ).rejects.toMatchObject({
      stage: "acquire",
      transportFailure: false,
    })
  }
})

test("fails closed on malformed RPC envelopes and invalid finish dispositions", async () => {
  for (const response of [null, {}, { data: null }, { error: null }]) {
    const { client } = fakeClient(() => response)
    await expect(
      gate.createEmailProofIssuanceGateRepository(client).acquire(validInput()),
    ).rejects.toMatchObject({ stage: "acquire" })
  }

  const { client, calls } = fakeClient(() => ({ data: null, error: null }))
  await expect(
    gate
      .createEmailProofIssuanceGateRepository(client)
      .finish(validInput(), "lost" as never),
  ).rejects.toMatchObject({ stage: "finish" })
  expect(calls).toHaveLength(0)
})

test("rejects unrecognized gate and context fields before RPC", async () => {
  for (const input of [
    { ...validInput(), recipientEmail: "must-not-cross-boundary@example.com" },
    {
      ...validInput(),
      context: {
        ...validInput().context,
        actorEmail: "must-not-cross-boundary",
      },
    },
  ]) {
    const { client, calls } = fakeClient(() => ({ data: null, error: null }))
    await expect(
      gate
        .createEmailProofIssuanceGateRepository(client)
        .acquire(input as GateInput),
    ).rejects.toMatchObject({ stage: "acquire" })
    expect(calls).toHaveLength(0)
  }
})
