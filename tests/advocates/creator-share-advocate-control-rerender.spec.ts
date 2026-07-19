import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { rm } from "node:fs/promises"
import { createServer } from "node:net"
import { resolve } from "node:path"

import { expect, test, type Page } from "@playwright/test"

const HARNESS_DIRECTORY = resolve(
  process.cwd(),
  "tests/fixtures/advocate-control-rerender-harness",
)
const NEXT_EXECUTABLE = resolve(
  process.cwd(),
  "node_modules/next/dist/bin/next",
)
const ALPHA_ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"
const BETA_ADVOCATE_ID = "22222222-2222-4222-8222-222222222222"

interface SubmittedRequest {
  url: string
  body: Record<string, unknown>
}

let harnessProcess: ChildProcessWithoutNullStreams | null = null
let harnessOrigin = ""
let harnessOutput = ""

test.describe.configure({ mode: "serial" })

async function removeHarnessArtifacts(): Promise<void> {
  await Promise.all([
    rm(resolve(HARNESS_DIRECTORY, ".next"), { recursive: true, force: true }),
    rm(resolve(HARNESS_DIRECTORY, "next-env.d.ts"), { force: true }),
    rm(resolve(HARNESS_DIRECTORY, "tsconfig.tsbuildinfo"), { force: true }),
  ])
}

async function stopHarnessProcess(): Promise<void> {
  const processToStop = harnessProcess
  harnessProcess = null
  if (
    processToStop === null ||
    processToStop.exitCode !== null ||
    processToStop.signalCode !== null
  ) {
    return
  }

  await new Promise<void>((resolveExit) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(forceKillTimeout)
      clearTimeout(exitTimeout)
      resolveExit()
    }
    const forceKillTimeout = setTimeout(() => {
      processToStop.kill("SIGKILL")
    }, 5_000)
    const exitTimeout = setTimeout(finish, 10_000)
    processToStop.once("exit", finish)
    if (!processToStop.kill("SIGTERM")) finish()
  })
}

async function reservePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address === null || typeof address === "string") {
        server.close()
        reject(new Error("component_harness_port_unavailable"))
        return
      }
      const { port } = address
      server.close((error) => {
        if (error) reject(error)
        else resolvePort(port)
      })
    })
  })
}

async function waitForHarness(origin: string): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const runningProcess = harnessProcess
    if (
      runningProcess === null ||
      runningProcess.exitCode !== null ||
      runningProcess.signalCode !== null
    ) {
      throw new Error(`component_harness_exited\n${harnessOutput}`)
    }
    try {
      const response = await fetch(origin)
      if (response.ok) return
    } catch {
      // The development server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`component_harness_start_timeout\n${harnessOutput}`)
}

async function installControlResponses(
  page: Page,
  submissions: SubmittedRequest[],
): Promise<void> {
  await page.route("**/api/admin/advocates/**", async (route) => {
    const request = route.request()
    const body = request.postDataJSON() as Record<string, unknown>
    submissions.push({ url: request.url(), body })

    if (request.url().endsWith("/lifecycle")) {
      const expectedVersion = body.expectedVersion
      const action = body.action
      if (typeof expectedVersion !== "number" || typeof action !== "string") {
        await route.abort()
        return
      }
      const lifecycleState =
        action === "archive"
          ? {
              relationshipStatus: "archived",
              publicationStatus: "suspended",
              domainCleanupRequested: true,
            }
          : {
              relationshipStatus: "suspended",
              publicationStatus: "suspended",
              domainCleanupRequested: false,
            }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          operationId: body.operationId,
          advocateVersion: expectedVersion + 1,
          ...lifecycleState,
        }),
      })
      return
    }

    if (request.url().endsWith("/cleanup-recovery")) {
      const expectedVersion = body.expectedVersion
      if (typeof expectedVersion !== "number") {
        await route.abort()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          operationId: body.operationId,
          advocateVersion: expectedVersion + 1,
          cleanupPhase: "cloudflare_dns_removal",
          cleanupRetryRequested: true,
        }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, operationId: body.operationId }),
    })
  })
}

test.beforeAll(async () => {
  await removeHarnessArtifacts()
  const port = await reservePort()
  harnessOrigin = `http://127.0.0.1:${port}`
  harnessProcess = spawn(
    process.execPath,
    [NEXT_EXECUTABLE, "dev", HARNESS_DIRECTORY, "--port", String(port)],
    {
      cwd: process.cwd(),
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: "pipe",
    },
  )
  harnessProcess.stdout.on("data", (chunk: Buffer) => {
    harnessOutput += chunk.toString()
  })
  harnessProcess.stderr.on("data", (chunk: Buffer) => {
    harnessOutput += chunk.toString()
  })
  try {
    await waitForHarness(harnessOrigin)
  } catch (error) {
    await stopHarnessProcess()
    await removeHarnessArtifacts()
    throw error
  }
})

test.afterAll(async () => {
  try {
    await stopHarnessProcess()
  } finally {
    await removeHarnessArtifacts()
  }
})

test.beforeEach(async ({ page }) => {
  await page.goto(harnessOrigin)
})

test("lifecycle state resets when navigation changes only the portal identity", async ({
  page,
}) => {
  const submissions: SubmittedRequest[] = []
  await installControlResponses(page, submissions)
  await page.reload()

  const controls = page.getByRole("region", { name: "Lifecycle controls" })
  await controls.getByLabel("Administrative reason").fill("Alpha suspension")
  await controls.getByRole("button", { name: "Suspend portal" }).click()
  await expect(controls.getByRole("status")).toHaveText(
    "Suspend portal completed.",
  )
  await expect(controls.getByLabel("Action")).toBeDisabled()

  await page.getByRole("button", { name: "Navigate to beta portal" }).click()

  await expect(controls.getByRole("status")).toHaveCount(0)
  await expect(controls.getByLabel("Action")).toBeEnabled()
  await expect(controls.getByLabel("Action")).toHaveValue("suspend")
  await expect(controls.getByLabel("Administrative reason")).toHaveValue("")
  await controls.getByLabel("Administrative reason").fill("Beta suspension")
  await controls.getByRole("button", { name: "Suspend portal" }).click()

  expect(submissions).toHaveLength(2)
  expect(submissions[0].url).toContain(
    `/api/admin/advocates/${ALPHA_ADVOCATE_ID}/lifecycle`,
  )
  expect(submissions[1].url).toContain(
    `/api/admin/advocates/${BETA_ADVOCATE_ID}/lifecycle`,
  )
  expect(submissions[0].body.operationId).not.toBe(
    submissions[1].body.operationId,
  )
  expect(submissions[1].body).toMatchObject({
    expectedVersion: 7,
    reason: "Beta suspension",
  })
})

test("lifecycle state accepts a refreshed snapshot after completion", async ({
  page,
}) => {
  const submissions: SubmittedRequest[] = []
  await installControlResponses(page, submissions)
  await page.reload()

  const controls = page.getByRole("region", { name: "Lifecycle controls" })
  await controls.getByLabel("Administrative reason").fill("First suspension")
  await controls.getByRole("button", { name: "Suspend portal" }).click()
  await expect(controls.getByLabel("Action")).toBeDisabled()

  await page.getByRole("button", { name: "Apply refreshed snapshot" }).click()

  await expect(controls.getByRole("status")).toHaveCount(0)
  await expect(controls.getByLabel("Action")).toBeEnabled()
  await expect(controls.getByLabel("Administrative reason")).toHaveValue("")
  await controls.getByLabel("Administrative reason").fill("Second suspension")
  await controls.getByRole("button", { name: "Suspend portal" }).click()

  expect(submissions).toHaveLength(2)
  expect(submissions[1].body).toMatchObject({
    expectedVersion: 8,
    reason: "Second suspension",
  })
  expect(submissions[0].body.operationId).not.toBe(
    submissions[1].body.operationId,
  )
})

test("cleanup recovery resets across portals and sends commands to the new portal", async ({
  page,
}) => {
  const submissions: SubmittedRequest[] = []
  await installControlResponses(page, submissions)
  await page.reload()

  const controls = page.getByRole("region", {
    name: "Retry protected cleanup",
  })
  await controls.getByLabel("Recovery reason").fill("Alpha cause corrected")
  await controls
    .getByLabel(/Type RETRY CLEANUP alpha/)
    .fill("RETRY CLEANUP alpha")
  await controls.getByRole("button", { name: "Retry cleanup" }).click()
  await expect(controls.getByRole("status")).toHaveText(
    "Cleanup retry requested. Automated strict-order cleanup will resume.",
  )
  await expect(controls.getByLabel("Recovery reason")).toBeDisabled()

  await page.getByRole("button", { name: "Navigate to beta portal" }).click()

  await expect(controls.getByRole("status")).toHaveCount(0)
  await expect(controls.getByLabel("Recovery reason")).toBeEnabled()
  await expect(controls.getByLabel("Recovery reason")).toHaveValue("")
  await expect(controls.getByLabel(/Type RETRY CLEANUP alpha/)).toHaveCount(0)
  await expect(controls.getByLabel(/Type RETRY CLEANUP beta/)).toHaveValue("")
  await controls.getByLabel("Recovery reason").fill("Beta cause corrected")
  await controls
    .getByLabel(/Type RETRY CLEANUP beta/)
    .fill("RETRY CLEANUP beta")
  await controls.getByRole("button", { name: "Retry cleanup" }).click()

  expect(submissions).toHaveLength(2)
  expect(submissions[0].url).toContain(
    `/api/admin/advocates/${ALPHA_ADVOCATE_ID}/cleanup-recovery`,
  )
  expect(submissions[1].url).toContain(
    `/api/admin/advocates/${BETA_ADVOCATE_ID}/cleanup-recovery`,
  )
  expect(submissions[0].body.operationId).not.toBe(
    submissions[1].body.operationId,
  )
})

test("cleanup recovery accepts refreshed props with an exact private command", async ({
  page,
}) => {
  const submissions: SubmittedRequest[] = []
  await installControlResponses(page, submissions)
  await page.reload()

  const controls = page.getByRole("region", {
    name: "Retry protected cleanup",
  })
  await controls.getByLabel("Recovery reason").fill("First cause corrected")
  await controls
    .getByLabel(/Type RETRY CLEANUP alpha/)
    .fill("RETRY CLEANUP alpha")
  await controls.getByRole("button", { name: "Retry cleanup" }).click()
  await expect(controls.getByLabel("Recovery reason")).toBeDisabled()

  await page.getByRole("button", { name: "Apply refreshed snapshot" }).click()

  await expect(controls.getByRole("status")).toHaveCount(0)
  await expect(controls.getByLabel("Recovery reason")).toBeEnabled()
  await expect(controls.getByLabel("Recovery reason")).toHaveValue("")
  await expect(controls.getByLabel(/Type RETRY CLEANUP alpha/)).toHaveValue("")
  await controls.getByLabel("Recovery reason").fill("Second cause corrected")
  await controls
    .getByLabel(/Type RETRY CLEANUP alpha/)
    .fill("RETRY CLEANUP alpha")
  await controls.getByRole("button", { name: "Retry cleanup" }).click()

  expect(submissions).toHaveLength(2)
  for (const submission of submissions) {
    expect(Object.keys(submission.body).sort()).toEqual([
      "confirmation",
      "expectedVersion",
      "operationId",
      "reason",
    ])
    expect(JSON.stringify(submission.body)).not.toMatch(/provider|job/i)
  }
  expect(submissions[1].body).toMatchObject({
    confirmation: "RETRY_CLEANUP",
    expectedVersion: 8,
    reason: "Second cause corrected",
  })
  expect(submissions[0].body.operationId).not.toBe(
    submissions[1].body.operationId,
  )
})

test("ownership state resets across portals with matching candidate sets", async ({
  page,
}) => {
  const submissions: SubmittedRequest[] = []
  await installControlResponses(page, submissions)
  await page.reload()

  const controls = page.getByRole("region", { name: "Ownership transfer" })
  await controls.getByLabel("Administrative reason").fill("Alpha owner change")
  await controls.getByLabel(/Type TRANSFER alpha/).fill("TRANSFER alpha")
  await controls.getByRole("button", { name: "Transfer ownership" }).click()
  await expect(controls.getByRole("status")).toHaveText(
    "Ownership transferred to Bailey Builder.",
  )
  await expect(controls.getByLabel("New owner")).toBeDisabled()

  await page.getByRole("button", { name: "Navigate to beta portal" }).click()

  await expect(controls.getByRole("status")).toHaveCount(0)
  await expect(controls.getByLabel("New owner")).toBeEnabled()
  await expect(controls.getByLabel("New owner")).toHaveValue(
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  )
  await expect(controls.getByLabel("Administrative reason")).toHaveValue("")
  await controls.getByLabel("Administrative reason").fill("Beta owner change")
  await controls.getByLabel(/Type TRANSFER beta/).fill("TRANSFER beta")
  await controls.getByRole("button", { name: "Transfer ownership" }).click()

  expect(submissions).toHaveLength(2)
  expect(submissions[0].url).toContain(
    `/api/admin/advocates/${ALPHA_ADVOCATE_ID}/ownership`,
  )
  expect(submissions[1].url).toContain(
    `/api/admin/advocates/${BETA_ADVOCATE_ID}/ownership`,
  )
  expect(submissions[0].body.operationId).not.toBe(
    submissions[1].body.operationId,
  )
})

test("ownership state accepts refreshed owner and candidate props", async ({
  page,
}) => {
  const submissions: SubmittedRequest[] = []
  await installControlResponses(page, submissions)
  await page.reload()

  const controls = page.getByRole("region", { name: "Ownership transfer" })
  await controls.getByLabel("Administrative reason").fill("First owner change")
  await controls.getByLabel(/Type TRANSFER alpha/).fill("TRANSFER alpha")
  await controls.getByRole("button", { name: "Transfer ownership" }).click()
  await expect(controls.getByLabel("New owner")).toBeDisabled()

  await page.getByRole("button", { name: "Apply refreshed snapshot" }).click()

  await expect(controls.getByRole("status")).toHaveCount(0)
  await expect(controls.getByLabel("New owner")).toBeEnabled()
  await expect(controls.getByLabel("New owner")).toHaveValue(
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  )
  await expect(controls.getByLabel("Administrative reason")).toHaveValue("")
  await expect(controls.getByLabel(/Type TRANSFER alpha/)).toHaveValue("")
  await controls.getByLabel("Administrative reason").fill("Second owner change")
  await controls.getByLabel(/Type TRANSFER alpha/).fill("TRANSFER alpha")
  await controls.getByRole("button", { name: "Transfer ownership" }).click()

  expect(submissions).toHaveLength(2)
  expect(submissions[1].body).toMatchObject({
    expectedOwnerMembershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    targetOwnerMembershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    reason: "Second owner change",
  })
  expect(submissions[0].body.operationId).not.toBe(
    submissions[1].body.operationId,
  )
})
