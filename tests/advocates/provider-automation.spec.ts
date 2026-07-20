import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type ProviderAutomationModule =
  typeof import("../../src/lib/advocates/providerAutomation")
type SentinelWorkerModule =
  typeof import("../../src/lib/advocates/publicationCanary/sentinelWorker")
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
  resolve(process.cwd(), "tests/advocates/provider-automation.spec.ts"),
)
const providerAutomation = testRequire(
  "../../src/lib/advocates/providerAutomation",
) as ProviderAutomationModule
const sentinelWorker = testRequire(
  "../../src/lib/advocates/publicationCanary/sentinelWorker",
) as SentinelWorkerModule
nodeModule._load = originalModuleLoad

const SECRET = "s".repeat(48)
const REQUEST_ID = "11111111-1111-4111-8111-111111111111"
const RUN_ID = "22222222-2222-4222-8222-222222222222"

function authorizedRequest(secret = SECRET): Request {
  return new Request("https://creatorshare.com/internal", {
    headers: { Authorization: `Bearer ${secret}` },
  })
}

test.describe("provider automation safety gate", () => {
  test("defaults missing configuration to disabled and accepts only exact modes", () => {
    expect(providerAutomation.loadProviderAutomationMode({})).toBe("disabled")
    expect(
      providerAutomation.loadProviderAutomationMode({
        ADVOCATE_PROVIDER_AUTOMATION_MODE: "disabled",
      }),
    ).toBe("disabled")
    expect(
      providerAutomation.loadProviderAutomationMode({
        ADVOCATE_PROVIDER_AUTOMATION_MODE: "active",
      }),
    ).toBe("active")

    for (const configured of [
      "",
      "ACTIVE",
      " active",
      "active ",
      "enabled",
      "false",
      "active\n",
    ]) {
      expect(() =>
        providerAutomation.loadProviderAutomationMode({
          ADVOCATE_PROVIDER_AUTOMATION_MODE: configured,
        }),
      ).toThrow(providerAutomation.ProviderAutomationConfigurationError)
    }
  })

  test("does not enter automation work when mode is missing, disabled, or malformed", async () => {
    for (const environment of [
      {},
      { ADVOCATE_PROVIDER_AUTOMATION_MODE: "disabled" },
      { ADVOCATE_PROVIDER_AUTOMATION_MODE: "malformed" },
    ]) {
      let workCalls = 0
      const execution =
        await providerAutomation.runWhenProviderAutomationActive(async () => {
          workCalls += 1
          return "provider result"
        }, environment)

      expect(execution).toEqual({ active: false })
      expect(workCalls).toBe(0)
    }
  })

  test("preserves active automation execution and its result", async () => {
    let workCalls = 0
    const execution = await providerAutomation.runWhenProviderAutomationActive(
      async () => {
        workCalls += 1
        return Object.freeze({ outcome: "ready" as const })
      },
      { ADVOCATE_PROVIDER_AUTOMATION_MODE: "active" },
    )

    expect(execution).toEqual({
      active: true,
      value: { outcome: "ready" },
    })
    expect(workCalls).toBe(1)
  })

  test("authenticates the sentinel worker before returning the fixed disabled result", async () => {
    let bootstrapCalls = 0
    const dependencies = {
      environment: { CRON_SECRET: SECRET },
      randomUUID: () => REQUEST_ID,
      async runBootstrap() {
        bootstrapCalls += 1
        return { ready: true as const, outcome: "ready" as const }
      },
    }

    const unauthorized =
      await sentinelWorker.handlePublicationCanarySentinelWorkerRequest(
        authorizedRequest("wrong".repeat(12)),
        dependencies,
      )
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      ok: false,
      code: "unauthorized",
    })

    const disabled =
      await sentinelWorker.handlePublicationCanarySentinelWorkerRequest(
        authorizedRequest(),
        dependencies,
      )
    expect(disabled.status).toBe(200)
    await expect(disabled.json()).resolves.toEqual(
      providerAutomation.PROVIDER_AUTOMATION_DISABLED_RESULT,
    )
    expect(bootstrapCalls).toBe(0)
  })

  test("treats malformed sentinel mode as disabled without exposing configuration", async () => {
    let bootstrapCalls = 0
    const response =
      await sentinelWorker.handlePublicationCanarySentinelWorkerRequest(
        authorizedRequest(),
        {
          environment: {
            CRON_SECRET: SECRET,
            ADVOCATE_PROVIDER_AUTOMATION_MODE: "activate",
          },
          randomUUID: () => REQUEST_ID,
          async runBootstrap() {
            bootstrapCalls += 1
            return { ready: true, outcome: "ready" }
          },
        },
      )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      code: "automation_disabled",
    })
    expect(bootstrapCalls).toBe(0)
  })

  test("keeps the sentinel active path unchanged", async () => {
    let bootstrapCalls = 0
    const response =
      await sentinelWorker.handlePublicationCanarySentinelWorkerRequest(
        authorizedRequest(),
        {
          environment: {
            CRON_SECRET: SECRET,
            ADVOCATE_PROVIDER_AUTOMATION_MODE: "active",
          },
          randomUUID: (() => {
            const values = [REQUEST_ID, RUN_ID]
            return () => values.shift() ?? RUN_ID
          })(),
          async runBootstrap(input) {
            bootstrapCalls += 1
            expect(input.runId).toBe(RUN_ID)
            expect(input.requestReferenceSha256).toMatch(/^[0-9a-f]{64}$/)
            return { ready: true, outcome: "ready" }
          },
        },
      )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ready: true,
      requestId: REQUEST_ID,
    })
    expect(bootstrapCalls).toBe(1)
  })

  test("places every provider worker gate after authentication and before work", () => {
    const routePaths = [
      "src/app/api/admin/advocates/[id]/publish/route.ts",
      "src/app/api/internal/advocates/provisioning/route.ts",
      "src/app/api/internal/advocates/publication-canaries/route.ts",
      "src/lib/advocates/publicationCanary/sentinelWorker.ts",
      "src/lib/advocates/lifecycleCleanup/route.ts",
    ]

    for (const routePath of routePaths) {
      const source = readFileSync(resolve(process.cwd(), routePath), "utf8")
      const handlerMarker = routePath.includes("/admin/")
        ? "export async function POST"
        : "async function handle"
      const handleSource = source.slice(source.indexOf(handlerMarker))
      const authorizationIndex = routePath.includes("/admin/")
        ? handleSource.indexOf("requireSuperAdmin")
        : handleSource.indexOf("isAuthorized")
      const gateIndex = handleSource.indexOf("runWhenProviderAutomationActive")
      expect(authorizationIndex, routePath).toBeGreaterThanOrEqual(0)
      expect(gateIndex, routePath).toBeGreaterThan(authorizationIndex)

      if (!routePath.includes("/admin/")) {
        const disabledResponseIndex = handleSource.indexOf(
          "PROVIDER_AUTOMATION_DISABLED_RESULT",
          gateIndex,
        )
        expect(disabledResponseIndex, routePath).toBeGreaterThan(gateIndex)
      }
    }

    const adminPublication = readFileSync(
      resolve(
        process.cwd(),
        "src/app/api/admin/advocates/[id]/publish/route.ts",
      ),
      "utf8",
    )
    const adminPublicationAfter = adminPublication.indexOf("after(async ()")
    const adminPublicationGate = adminPublication.indexOf(
      "runWhenProviderAutomationActive",
      adminPublicationAfter,
    )
    expect(adminPublicationAfter).toBeGreaterThanOrEqual(0)
    expect(adminPublicationGate).toBeGreaterThan(adminPublicationAfter)
    for (const operation of [
      "createServiceRoleClient()",
      "createPublicationCanaryWorkerDatabase(serviceRoleClient)",
      "createPublicationCanarySentinelBootstrapRuntimeDependencies(",
      "createPublicationCanarySentinelEvidenceRepository(",
      "createPublicationCanaryRuntimeDependencies({",
      "processNextPublicationCanaryExecution(",
    ]) {
      expect(
        adminPublication.indexOf(operation, adminPublicationAfter),
        operation,
      ).toBeGreaterThan(adminPublicationGate)
    }

    const provisioning = readFileSync(
      resolve(
        process.cwd(),
        "src/app/api/internal/advocates/provisioning/route.ts",
      ),
      "utf8",
    )
    const provisioningGate = provisioning.indexOf(
      "runWhenProviderAutomationActive",
      provisioning.indexOf("async function handle"),
    )
    for (const operation of [
      "loadDomainWorkerConfig()",
      "createServiceRoleClient({",
      "createSupabaseDomainProvisioningRepository(",
      "createDomainProviderAdapterFactory()",
      "runScheduledDomainProvisioningBatch({",
    ]) {
      expect(provisioning.indexOf(operation), operation).toBeGreaterThan(
        provisioningGate,
      )
    }

    const canary = readFileSync(
      resolve(
        process.cwd(),
        "src/app/api/internal/advocates/publication-canaries/route.ts",
      ),
      "utf8",
    )
    const canaryGate = canary.indexOf(
      "runWhenProviderAutomationActive",
      canary.indexOf("async function handle"),
    )
    for (const operation of [
      "loadPublicationCanaryDeploymentIdentity()",
      "createServiceRoleClient({",
      "createPublicationCanarySentinelEvidenceRepository(",
      "createPublicationCanaryWorkerDatabase(",
      "createPublicationCanaryRuntimeDependencies({",
    ]) {
      expect(canary.indexOf(operation), operation).toBeGreaterThan(canaryGate)
    }

    const lifecycleCleanup = readFileSync(
      resolve(process.cwd(), "src/lib/advocates/lifecycleCleanup/route.ts"),
      "utf8",
    )
    const lifecycleCleanupGate = lifecycleCleanup.indexOf(
      "runWhenProviderAutomationActive",
      lifecycleCleanup.indexOf("handleArchivedAdvocateDomainCleanupRequest"),
    )
    for (const operation of [
      "loadArchivedAdvocateDomainCleanupWorkerConfig(environment)",
      "runArchivedAdvocateDomainCleanupWorker({",
      "dependencies.createExecutor()",
    ]) {
      expect(lifecycleCleanup.indexOf(operation), operation).toBeGreaterThan(
        lifecycleCleanupGate,
      )
    }
  })
})
