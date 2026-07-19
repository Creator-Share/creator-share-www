import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"
import { readFileSync } from "node:fs"

import { expect, test } from "@playwright/test"

type WorkerAuthModule =
  typeof import("../../src/lib/advocates/publicationCanary/workerAuth")
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
  resolve(process.cwd(), "tests/advocates/publication-canary-worker.spec.ts"),
)
const {
  isAuthorizedPublicationCanaryWorkerRequest,
  loadPublicationCanaryWorkerSecret,
} = testRequire(
  resolve(
    process.cwd(),
    "src/lib/advocates/publicationCanary/workerAuth.ts",
  ),
) as WorkerAuthModule

const CRON_SECRET = "c".repeat(48)
const DEDICATED_SECRET = "d".repeat(48)

test.describe("publication canary worker boundary", () => {
  test("uses the exact Vercel cron secret", () => {
    expect(loadPublicationCanaryWorkerSecret({ CRON_SECRET })).toBe(
      CRON_SECRET,
    )
  })

  test("rejects missing, short, padded, and control-bearing secrets", () => {
    for (const environment of [
      {},
      { CRON_SECRET: "short" },
      { CRON_SECRET: ` ${CRON_SECRET}` },
      { CRON_SECRET: `${CRON_SECRET}\n` },
    ]) {
      expect(() => loadPublicationCanaryWorkerSecret(environment)).toThrow(
        "advocate_publication_canary_worker_secret_invalid",
      )
    }
  })

  test("requires one exact bearer credential", () => {
    expect(
      isAuthorizedPublicationCanaryWorkerRequest(
        `Bearer ${CRON_SECRET}`,
        CRON_SECRET,
      ),
    ).toBe(true)
    for (const authorization of [
      null,
      CRON_SECRET,
      `bearer ${CRON_SECRET}`,
      `Bearer  ${CRON_SECRET}`,
      `Bearer ${CRON_SECRET} `,
      `Bearer ${DEDICATED_SECRET}`,
    ]) {
      expect(
        isAuthorizedPublicationCanaryWorkerRequest(
          authorization,
          CRON_SECRET,
        ),
      ).toBe(false)
    }
  })

  test("keeps the public request asynchronous and cron recovery durable", () => {
    const adminRoute = readFileSync(
      resolve(
        process.cwd(),
        "src/app/api/admin/advocates/[id]/publish/route.ts",
      ),
      "utf8",
    )
    const workerRoute = readFileSync(
      resolve(
        process.cwd(),
        "src/app/api/internal/advocates/publication-canaries/route.ts",
      ),
      "utf8",
    )
    const vercel = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as {
      functions?: Record<string, { maxDuration?: number }>
      crons?: Array<{ path?: string; schedule?: string }>
    }

    expect(adminRoute).toContain("export const maxDuration = 300")
    expect(adminRoute).toContain("after(async () =>")
    expect(adminRoute.indexOf("await handlePublicationCanaryOperation")).toBeLessThan(
      adminRoute.indexOf("after(async () =>"),
    )
    expect(adminRoute).not.toContain("await runPublicationCanary(")
    expect(workerRoute).toContain("processNextPublicationCanaryExecution")
    expect(workerRoute).toContain("loadPublicationCanaryWorkerSecret")
    expect(
      vercel.functions?.[
        "src/app/api/internal/advocates/publication-canaries/route.ts"
      ]?.maxDuration,
    ).toBe(300)
    expect(vercel.crons).toContainEqual({
      path: "/api/internal/advocates/publication-canaries",
      schedule: "* * * * *",
    })
  })
})
