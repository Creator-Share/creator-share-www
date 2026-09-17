import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import type { SupabaseClient } from "@supabase/supabase-js"

type PublicPresentationRepositoryModule =
  typeof import("../../src/lib/advocates/publicPresentationRepository")
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
    "tests/advocates/public-presentation-repository.spec.ts",
  ),
)
const repositoryModule = testRequire(
  "../../src/lib/advocates/publicPresentationRepository",
) as PublicPresentationRepositoryModule
nodeModule._load = originalModuleLoad

const {
  PublicAdvocatePresentationRepositoryError,
  createServiceRolePublicAdvocatePresentationRepository,
} = repositoryModule

function clientWithRpc(
  implementation: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string } | null }>,
): SupabaseClient {
  return { rpc: implementation } as unknown as SupabaseClient
}

test.describe("public advocate presentation repository", () => {
  test("loads one statement-consistent allowlisted RPC snapshot", async () => {
    const calls: Array<{
      functionName: string
      parameters: Record<string, unknown>
    }> = []
    const snapshot = { domain: { hostname: "alice.creatorshare.com" } }
    const client = clientWithRpc(async (functionName, parameters) => {
      calls.push({ functionName, parameters })
      return { data: snapshot, error: null }
    })

    const repository =
      createServiceRolePublicAdvocatePresentationRepository(client)
    await expect(
      repository.loadByCanonicalHostname("alice.creatorshare.com"),
    ).resolves.toBe(snapshot)
    expect(calls).toEqual([
      {
        functionName: "read_public_advocate_presentation_snapshot",
        parameters: { target_hostname: "alice.creatorshare.com" },
      },
    ])
  })

  test("preserves the unavailable null result", async () => {
    const client = clientWithRpc(async () => ({ data: null, error: null }))
    const repository =
      createServiceRolePublicAdvocatePresentationRepository(client)

    await expect(
      repository.loadByCanonicalHostname("unknown.creatorshare.com"),
    ).resolves.toBeNull()
  })

  test("throws a typed operational error without swallowing the RPC failure", async () => {
    const cause = { code: "PGRST999" }
    const client = clientWithRpc(async () => ({ data: null, error: cause }))
    const repository =
      createServiceRolePublicAdvocatePresentationRepository(client)

    await expect(
      repository.loadByCanonicalHostname("alice.creatorshare.com"),
    ).rejects.toMatchObject({
      name: "PublicAdvocatePresentationRepositoryError",
      message: "public_advocate_presentation_repository_failure",
      stage: "snapshot",
      cause,
    })
  })

  test("rejects a malformed non-object snapshot", async () => {
    const client = clientWithRpc(async () => ({
      data: ["not", "a", "snapshot"],
      error: null,
    }))
    const repository =
      createServiceRolePublicAdvocatePresentationRepository(client)

    await expect(
      repository.loadByCanonicalHostname("alice.creatorshare.com"),
    ).rejects.toBeInstanceOf(PublicAdvocatePresentationRepositoryError)
    await expect(
      repository.loadByCanonicalHostname("alice.creatorshare.com"),
    ).rejects.toMatchObject({ stage: "snapshot_shape" })
  })
})
