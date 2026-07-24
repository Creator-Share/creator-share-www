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
const ONBOARDING_STORAGE_KEY = "creator-share:advocate-onboarding-operation:v1"
const INITIAL_OWNER_REISSUE_STORAGE_KEY = `creator-share:initial-owner-reissue-operation:v1:${ALPHA_ADVOCATE_ID}`
const INITIAL_OWNER_REVOCATION_STORAGE_KEY = `creator-share:initial-owner-revocation-operation:v1:${ALPHA_ADVOCATE_ID}`
const ALPHA_PUBLICATION_STORAGE_KEY = `creator-share:advocate-publication-operation:v1:${ALPHA_ADVOCATE_ID}`
const BETA_PUBLICATION_STORAGE_KEY = `creator-share:advocate-publication-operation:v1:${BETA_ADVOCATE_ID}`
const PUBLICATION_RUN_ID = "33333333-3333-4333-8333-333333333333"
const OTHER_PUBLICATION_RUN_ID = "44444444-4444-4444-8444-444444444444"

interface SubmittedRequest {
  url: string
  body: Record<string, unknown>
}

let harnessProcess: ChildProcessWithoutNullStreams | null = null
let harnessOrigin = ""
let harnessOutput = ""

// This suite drives a harness served by `next dev`, which compiles routes on
// demand. The first interaction with a not-yet-compiled route pays that compile
// cost inside the test, and a shared CI runner is slow enough for that to
// exceed the 30 second default. The work is real, not a hang, so the file gets
// a timeout sized for a cold compile rather than a fast developer machine.
test.describe.configure({ mode: "serial", timeout: 120_000 })

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

    if (request.url().endsWith("/initial-owner/reissue")) {
      const expectedVersion = body.expectedVersion
      if (typeof expectedVersion !== "number") {
        await route.abort()
        return
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          operationId: body.operationId,
          advocateId: ALPHA_ADVOCATE_ID,
          advocateVersion: expectedVersion + 1,
          reissueStatus: "initial_owner_invitation_requeued",
        }),
      })
      return
    }

    if (request.url().endsWith("/initial-owner/revoke")) {
      const expectedVersion = body.expectedVersion
      if (typeof expectedVersion !== "number") {
        await route.abort()
        return
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          operationId: body.operationId,
          advocateId: ALPHA_ADVOCATE_ID,
          advocateVersion: expectedVersion + 1,
          revocationStatus: "initial_owner_invitation_revoked",
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

async function fillOnboardingForm(page: Page): Promise<void> {
  const onboarding = page.getByRole("region", {
    name: "Create an advocate portal",
  })
  await onboarding.getByLabel("Subdomain").fill("hope-partners")
  await onboarding.getByLabel("Public display name").fill("Hope Partners")
  await onboarding.getByLabel("Advocate type").selectOption("organization")
  await onboarding.getByLabel("Initial owner email").fill("owner@example.com")
  await onboarding
    .getByLabel("Administrative reason")
    .fill("Create the approved Hope Partners advocate portal.")
}

async function fillInitialOwnerReissueForm(page: Page): Promise<void> {
  const recovery = page.getByRole("region", {
    name: "Reissue initial owner invitation",
  })
  await recovery.getByLabel("Initial owner email").fill("owner@example.com")
  await recovery
    .getByLabel("Administrative reason")
    .fill("The prior invitation expired before secure acceptance.")
  await recovery
    .getByLabel(/Type REISSUE OWNER alpha/)
    .fill("REISSUE OWNER alpha")
}

async function fillInitialOwnerRevocationForm(page: Page): Promise<void> {
  const revocation = page.getByRole("region", {
    name: "Revoke initial owner invitation",
  })
  await revocation
    .getByLabel("Administrative reason")
    .fill("Invalidate the current owner link before replacing it.")
  await revocation
    .getByLabel(/Type REVOKE OWNER alpha/)
    .fill("REVOKE OWNER alpha")
}

async function fillPublicationForm(page: Page): Promise<void> {
  const publication = page.getByRole("region", {
    name: "Publish advocate portal",
  })
  await publication
    .getByLabel("Administrative reason")
    .fill("Approve the exact verified production release for this portal.")
  await publication.getByLabel(/Type PUBLISH alpha/).fill("PUBLISH alpha")
}

/**
 * Waits until the harness has hydrated. Filling a controlled input before
 * hydration loses the value when React takes over, which leaves the dependent
 * submit button disabled for the rest of the test. The failure only appears on
 * a slow runner, so every navigation and reload passes through here.
 */
async function waitForHarnessHydration(page: Page): Promise<void> {
  await expect(page.locator('main[data-harness-hydrated="true"]')).toBeVisible()
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
  await waitForHarnessHydration(page)
})

test("lifecycle state resets when navigation changes only the portal identity", async ({
  page,
}) => {
  const submissions: SubmittedRequest[] = []
  await installControlResponses(page, submissions)
  await page.reload()
  await waitForHarnessHydration(page)

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
  await waitForHarnessHydration(page)

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
  await waitForHarnessHydration(page)

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
  await waitForHarnessHydration(page)

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
  await waitForHarnessHydration(page)

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
  await waitForHarnessHydration(page)

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

test("onboarding restores one privacy-limited operation after reload", async ({
  page,
}) => {
  const submissions: Record<string, unknown>[] = []
  await page.route(/\/api\/admin\/advocates$/, async (route) => {
    const requestBody = route.request().postDataJSON() as Record<
      string,
      unknown
    >
    submissions.push(requestBody)
    if (submissions.length === 1) {
      await route.abort("connectionfailed")
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        operationId: requestBody.operationId,
        advocateId: ALPHA_ADVOCATE_ID,
        advocateVersion: 1,
        onboardingStatus: "initial_owner_invitation_queued",
      }),
    })
  })

  await fillOnboardingForm(page)
  await page
    .getByRole("region", { name: "Create an advocate portal" })
    .getByRole("button", { name: "Reserve portal and invite owner" })
    .click()
  await expect(
    page
      .getByRole("region", { name: "Create an advocate portal" })
      .getByRole("alert"),
  ).toContainText("could not be confirmed")

  const storedBeforeReload = await page.evaluate((key) => {
    const raw = sessionStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  }, ONBOARDING_STORAGE_KEY)
  expect(storedBeforeReload).toEqual({
    version: 1,
    operationId: submissions[0].operationId,
  })
  expect(JSON.stringify(storedBeforeReload)).not.toMatch(
    /email|name|reason|slug/i,
  )

  await page.reload()
  await waitForHarnessHydration(page)
  await expect(page.getByText("A previous result is unresolved.")).toBeVisible()
  await fillOnboardingForm(page)
  await page
    .getByRole("region", { name: "Create an advocate portal" })
    .getByRole("button", { name: "Reserve portal and invite owner" })
    .click()

  await expect(page.getByText("Portal reserved.")).toBeVisible()
  expect(submissions).toHaveLength(2)
  expect(submissions[1].operationId).toBe(submissions[0].operationId)
  await expect
    .poll(
      async () =>
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          ONBOARDING_STORAGE_KEY,
        ),
    )
    .toBeNull()
})

test("onboarding retains the saved operation through authentication loss", async ({
  page,
}) => {
  let submittedOperationId: unknown = null
  await page.route(/\/api\/admin\/advocates$/, async (route) => {
    const requestBody = route.request().postDataJSON() as Record<
      string,
      unknown
    >
    submittedOperationId = requestBody.operationId
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        operationId: null,
        code: "unauthorized",
      }),
    })
  })

  await fillOnboardingForm(page)
  await page
    .getByRole("region", { name: "Create an advocate portal" })
    .getByRole("button", { name: "Reserve portal and invite owner" })
    .click()
  await expect(
    page
      .getByRole("region", { name: "Create an advocate portal" })
      .getByRole("alert"),
  ).toContainText("session expired")

  const stored = await page.evaluate((key) => {
    const raw = sessionStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  }, ONBOARDING_STORAGE_KEY)
  expect(stored).toEqual({ version: 1, operationId: submittedOperationId })
  await page.reload()
  await waitForHarnessHydration(page)
  await expect(page.getByText("A previous result is unresolved.")).toBeVisible()
})

test("onboarding retains retry identity after a generic conflict", async ({
  page,
}) => {
  let submittedOperationId: unknown = null
  await page.route(/\/api\/admin\/advocates$/, async (route) => {
    const requestBody = route.request().postDataJSON() as Record<
      string,
      unknown
    >
    submittedOperationId = requestBody.operationId
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        operationId: requestBody.operationId,
        code: "onboarding_conflict",
      }),
    })
  })

  await fillOnboardingForm(page)
  await page
    .getByRole("region", { name: "Create an advocate portal" })
    .getByRole("button", { name: "Reserve portal and invite owner" })
    .click()

  expect(
    await page.evaluate((key) => {
      const raw = sessionStorage.getItem(key)
      return raw === null ? null : JSON.parse(raw)
    }, ONBOARDING_STORAGE_KEY),
  ).toEqual({ version: 1, operationId: submittedOperationId })
})

test("ownerless recovery hides ownership controls and starts only from server eligibility", async ({
  page,
}) => {
  const ownerless = page.getByRole("region", {
    name: "Ownerless portal controls",
  })
  await expect(ownerless.getByText("Awaiting owner acceptance")).toBeVisible()
  await expect(
    ownerless.getByRole("region", {
      name: "Reissue initial owner invitation",
    }),
  ).toBeVisible()
  await expect(ownerless.getByText(/safely terminal/)).toBeVisible()
  await expect(
    ownerless.getByRole("region", { name: "Ownership transfer" }),
  ).toHaveCount(0)
  await expect(
    ownerless.getByRole("region", { name: "Lifecycle controls" }),
  ).toHaveCount(0)

  await page
    .getByRole("button", { name: "Reload ineligible owner snapshot" })
    .click()
  const recoveredOwnerless = page.getByRole("region", {
    name: "Ownerless portal controls",
  })
  await expect(recoveredOwnerless.getByText(/not eligible/)).toBeVisible()
  await expect(
    recoveredOwnerless.getByRole("region", {
      name: "Initial owner invitation pending",
    }),
  ).toBeVisible()
  await expect(
    recoveredOwnerless.getByLabel("Initial owner email"),
  ).toHaveCount(0)
})

test("initial owner reissue recovers a lost committed response after a version-advanced reload", async ({
  page,
}) => {
  const submissions: Record<string, unknown>[] = []
  await page.route(/\/initial-owner\/reissue$/, async (route) => {
    const requestBody = route.request().postDataJSON() as Record<
      string,
      unknown
    >
    submissions.push(requestBody)
    if (submissions.length === 1) {
      await route.abort("connectionfailed")
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        operationId: requestBody.operationId,
        advocateId: ALPHA_ADVOCATE_ID,
        advocateVersion: 8,
        reissueStatus: "initial_owner_invitation_requeued",
      }),
    })
  })

  await fillInitialOwnerReissueForm(page)
  const recovery = page.getByRole("region", {
    name: "Reissue initial owner invitation",
  })
  await recovery
    .getByRole("button", { name: "Reissue owner invitation" })
    .click()
  await expect(recovery.getByRole("alert")).toContainText(
    "could not be confirmed",
  )

  const storedBeforeReload = await page.evaluate((key) => {
    const raw = sessionStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  }, INITIAL_OWNER_REISSUE_STORAGE_KEY)
  expect(storedBeforeReload).toEqual({
    version: 1,
    operationId: submissions[0].operationId,
    advocateId: ALPHA_ADVOCATE_ID,
    expectedVersion: 7,
  })
  expect(JSON.stringify(storedBeforeReload)).not.toMatch(/email|reason|slug/i)

  await page
    .getByRole("button", {
      name: "Reload committed reissue snapshot",
    })
    .click()
  const recovered = page.getByRole("region", {
    name: "Reissue initial owner invitation",
  })
  await expect(
    recovered.getByText("A previous result is unresolved."),
  ).toBeVisible()
  await fillInitialOwnerReissueForm(page)
  await recovered
    .getByRole("button", { name: "Reissue owner invitation" })
    .click()

  expect(submissions).toHaveLength(2)
  expect(submissions[1].operationId).toBe(submissions[0].operationId)
  expect(submissions[1].expectedVersion).toBe(7)
  expect(Object.keys(submissions[1]).sort()).toEqual([
    "confirmation",
    "expectedVersion",
    "operationId",
    "ownerEmail",
    "reason",
  ])
  await expect
    .poll(
      async () =>
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          INITIAL_OWNER_REISSUE_STORAGE_KEY,
        ),
    )
    .toBeNull()
  await expect(
    page.getByRole("region", { name: "Revoke initial owner invitation" }),
  ).toBeVisible()
})

test("initial owner reissue retains retry identity through authentication loss", async ({
  page,
}) => {
  let operationId: unknown = null
  await page.route(/\/initial-owner\/reissue$/, async (route) => {
    const requestBody = route.request().postDataJSON() as Record<
      string,
      unknown
    >
    operationId = requestBody.operationId
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        operationId: null,
        code: "unauthorized",
      }),
    })
  })

  await fillInitialOwnerReissueForm(page)
  const recovery = page.getByRole("region", {
    name: "Reissue initial owner invitation",
  })
  await recovery
    .getByRole("button", { name: "Reissue owner invitation" })
    .click()
  await expect(recovery.getByRole("alert")).toContainText("session expired")

  expect(
    await page.evaluate((key) => {
      const raw = sessionStorage.getItem(key)
      return raw === null ? null : JSON.parse(raw)
    }, INITIAL_OWNER_REISSUE_STORAGE_KEY),
  ).toEqual({
    version: 1,
    operationId,
    advocateId: ALPHA_ADVOCATE_ID,
    expectedVersion: 7,
  })
  await page.reload()
  await waitForHarnessHydration(page)
  await expect(
    page
      .getByRole("region", { name: "Reissue initial owner invitation" })
      .getByText("A previous result is unresolved."),
  ).toBeVisible()
})

test("saved revocation replay outranks newly available reissue after a version-advanced reload", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Reload revocable owner snapshot" })
    .click()
  const submissions: Record<string, unknown>[] = []
  await page.route(/\/initial-owner\/revoke$/, async (route) => {
    const requestBody = route.request().postDataJSON() as Record<
      string,
      unknown
    >
    submissions.push(requestBody)
    if (submissions.length === 1) {
      await route.abort("connectionfailed")
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        operationId: requestBody.operationId,
        advocateId: ALPHA_ADVOCATE_ID,
        advocateVersion: 8,
        revocationStatus: "initial_owner_invitation_revoked",
      }),
    })
  })

  await fillInitialOwnerRevocationForm(page)
  const revocation = page.getByRole("region", {
    name: "Revoke initial owner invitation",
  })
  await revocation
    .getByRole("button", { name: "Revoke owner invitation" })
    .click()
  await expect(revocation.getByRole("alert")).toContainText(
    "could not be confirmed",
  )
  expect(
    await page.evaluate((key) => {
      const raw = sessionStorage.getItem(key)
      return raw === null ? null : JSON.parse(raw)
    }, INITIAL_OWNER_REVOCATION_STORAGE_KEY),
  ).toEqual({
    version: 1,
    operationId: submissions[0].operationId,
    advocateId: ALPHA_ADVOCATE_ID,
    expectedVersion: 7,
  })

  await page
    .getByRole("button", {
      name: "Reload committed revocation snapshot",
    })
    .click()
  const recovered = page.getByRole("region", {
    name: "Revoke initial owner invitation",
  })
  await expect(
    recovered.getByText("A previous result is unresolved."),
  ).toBeVisible()
  await fillInitialOwnerRevocationForm(page)
  await recovered
    .getByRole("button", { name: "Revoke owner invitation" })
    .click()

  expect(submissions).toHaveLength(2)
  expect(submissions[1]).toMatchObject({
    operationId: submissions[0].operationId,
    expectedVersion: 7,
    confirmation: "REVOKE_INITIAL_OWNER",
  })
  expect(Object.keys(submissions[1]).sort()).toEqual([
    "confirmation",
    "expectedVersion",
    "operationId",
    "reason",
  ])
  await expect
    .poll(
      async () =>
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          INITIAL_OWNER_REVOCATION_STORAGE_KEY,
        ),
    )
    .toBeNull()
  await expect(
    page.getByRole("region", { name: "Reissue initial owner invitation" }),
  ).toBeVisible()
})

test("publication recovers a lost first response with the exact saved request", async ({
  page,
}) => {
  const submissions: Record<string, unknown>[] = []
  await page.route(/\/publish$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    submissions.push(body)
    if (submissions.length === 1) {
      await route.abort("connectionfailed")
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        code: "publication_committed",
        operationId: body.operationId,
        runId: PUBLICATION_RUN_ID,
        advocateVersion: 8,
      }),
    })
  })

  await fillPublicationForm(page)
  const publication = page.getByRole("region", {
    name: "Publish advocate portal",
  })
  await publication
    .getByRole("button", { name: "Start publication check" })
    .click()
  await expect(publication.getByRole("alert")).toContainText(
    "could not be confirmed",
  )

  const saved = await page.evaluate((key) => {
    const raw = sessionStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  }, ALPHA_PUBLICATION_STORAGE_KEY)
  expect(saved).toEqual({
    version: 1,
    advocateId: ALPHA_ADVOCATE_ID,
    operationId: submissions[0].operationId,
    expectedVersion: 7,
    adminReason:
      "Approve the exact verified production release for this portal.",
    runId: null,
  })

  await page.reload()
  await waitForHarnessHydration(page)
  await expect(publication.getByRole("status")).toContainText(
    "Publication committed",
  )
  expect(submissions).toHaveLength(2)
  expect(submissions[1]).toEqual(submissions[0])
  expect(Object.keys(submissions[1]).sort()).toEqual([
    "adminReason",
    "expectedVersion",
    "operationId",
  ])
  await expect
    .poll(
      async () =>
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          ALPHA_PUBLICATION_STORAGE_KEY,
        ),
    )
    .toBeNull()
})

test("publication times out after response headers when the body stalls", async ({
  page,
}) => {
  // Intentionally no narrower timeout here. This test was raised to 45 seconds
  // against the old 30 second default; the file-level timeout is now larger, so
  // re-declaring 45 seconds would only shrink the budget on a slow runner.

  await fillPublicationForm(page)
  const publication = page.getByRole("region", {
    name: "Publish advocate portal",
  })
  await publication
    .getByRole("button", { name: "Start publication check" })
    .click()

  await expect(publication.getByRole("alert")).toContainText(
    "could not be confirmed",
    { timeout: 25_000 },
  )
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      ALPHA_PUBLICATION_STORAGE_KEY,
    ),
  ).not.toBeNull()
})

test("publication binds the first run and polls only the saved operation", async ({
  page,
}) => {
  const submissions: Record<string, unknown>[] = []
  await page.route(/\/publish$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    submissions.push(body)
    if (submissions.length === 1) {
      await route.fulfill({
        status: 202,
        headers: { "Retry-After": "1" },
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          code: "publication_canary_pending",
          operationId: body.operationId,
          runId: PUBLICATION_RUN_ID,
          publicationStatus: "verifying",
          retryAfterSeconds: 1,
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        code: "publication_committed",
        operationId: body.operationId,
        runId: PUBLICATION_RUN_ID,
        advocateVersion: 8,
      }),
    })
  })

  await fillPublicationForm(page)
  const publication = page.getByRole("region", {
    name: "Publish advocate portal",
  })
  await publication
    .getByRole("button", { name: "Start publication check" })
    .click()
  await expect(publication.getByRole("status")).toContainText("still running")
  await expect
    .poll(async () => {
      return await page.evaluate((key) => {
        const raw = sessionStorage.getItem(key)
        return raw === null ? null : JSON.parse(raw).runId
      }, ALPHA_PUBLICATION_STORAGE_KEY)
    })
    .toBe(PUBLICATION_RUN_ID)
  await expect(publication.getByRole("status")).toContainText(
    "Publication committed",
  )
  expect(submissions).toHaveLength(2)
  expect(submissions[1]).toEqual(submissions[0])
})

test("publication retains its operation through authentication loss and reload", async ({
  page,
}) => {
  const submissions: Record<string, unknown>[] = []
  await page.route(/\/publish$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    submissions.push(body)
    if (submissions.length === 1) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          code: "unauthorized",
          operationId: body.operationId,
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        code: "publication_committed",
        operationId: body.operationId,
        runId: PUBLICATION_RUN_ID,
        advocateVersion: 8,
      }),
    })
  })

  await fillPublicationForm(page)
  const publication = page.getByRole("region", {
    name: "Publish advocate portal",
  })
  await publication
    .getByRole("button", { name: "Start publication check" })
    .click()
  await expect(publication.getByRole("alert")).toContainText("session expired")
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      ALPHA_PUBLICATION_STORAGE_KEY,
    ),
  ).not.toBeNull()

  await page.reload()
  await waitForHarnessHydration(page)
  await expect(publication.getByRole("status")).toContainText(
    "Publication committed",
  )
  expect(submissions).toHaveLength(2)
  expect(submissions[1]).toEqual(submissions[0])
})

test("publication rejects a changed run identity and retains the authoritative binding", async ({
  page,
}) => {
  const submissions: Record<string, unknown>[] = []
  await page.route(/\/publish$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    submissions.push(body)
    if (submissions.length === 1) {
      await route.fulfill({
        status: 202,
        headers: { "Retry-After": "1" },
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          code: "publication_canary_pending",
          operationId: body.operationId,
          runId: PUBLICATION_RUN_ID,
          publicationStatus: "verifying",
          retryAfterSeconds: 1,
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        code: "publication_committed",
        operationId: body.operationId,
        runId: OTHER_PUBLICATION_RUN_ID,
        advocateVersion: 8,
      }),
    })
  })

  await fillPublicationForm(page)
  const publication = page.getByRole("region", {
    name: "Publish advocate portal",
  })
  await publication
    .getByRole("button", { name: "Start publication check" })
    .click()
  await expect(publication.getByRole("alert")).toContainText(
    "could not preserve the exact run binding",
  )
  expect(
    await page.evaluate((key) => {
      const raw = sessionStorage.getItem(key)
      return raw === null ? null : JSON.parse(raw).runId
    }, ALPHA_PUBLICATION_STORAGE_KEY),
  ).toBe(PUBLICATION_RUN_ID)
})

test("publication keeps a terminal result until explicit acknowledgment", async ({
  page,
}) => {
  await page.route(/\/publish$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        code: "publication_canary_expired",
        operationId: body.operationId,
        runId: PUBLICATION_RUN_ID,
        retryWithNewOperationId: true,
      }),
    })
  })

  await fillPublicationForm(page)
  const publication = page.getByRole("region", {
    name: "Publish advocate portal",
  })
  await publication
    .getByRole("button", { name: "Start publication check" })
    .click()
  await expect(publication.getByRole("alert")).toContainText("evidence expired")
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      ALPHA_PUBLICATION_STORAGE_KEY,
    ),
  ).not.toBeNull()
  await publication
    .getByRole("button", { name: "Acknowledge terminal result" })
    .click()
  await expect
    .poll(
      async () =>
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          ALPHA_PUBLICATION_STORAGE_KEY,
        ),
    )
    .toBeNull()
})

test("publication fails closed when same-tab recovery storage is blocked", async ({
  page,
}) => {
  let publicationRequests = 0
  await page.route(/\/publish$/, async (route) => {
    publicationRequests += 1
    await route.abort()
  })
  await page.addInitScript((keyPrefix) => {
    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function guardedSetItem(key, value) {
      if (key.startsWith(keyPrefix)) throw new Error("storage_blocked")
      return originalSetItem.call(this, key, value)
    }
  }, "creator-share:advocate-publication-operation:v1:")
  await page.reload()
  await waitForHarnessHydration(page)

  await fillPublicationForm(page)
  const publication = page.getByRole("region", {
    name: "Publish advocate portal",
  })
  await publication
    .getByRole("button", { name: "Start publication check" })
    .click()
  await expect(publication.getByRole("alert")).toContainText(
    "No request was sent",
  )
  expect(publicationRequests).toBe(0)
})

test("publication cannot start again when exact success storage cleanup fails", async ({
  page,
}) => {
  await page.addInitScript((keyPrefix) => {
    const originalRemoveItem = Storage.prototype.removeItem
    Storage.prototype.removeItem = function guardedRemoveItem(key) {
      if (key.startsWith(keyPrefix)) throw new Error("storage_cleanup_blocked")
      return originalRemoveItem.call(this, key)
    }
  }, "creator-share:advocate-publication-operation:v1:")
  await page.reload()
  await waitForHarnessHydration(page)
  await page.route(/\/publish$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        code: "publication_committed",
        operationId: body.operationId,
        runId: PUBLICATION_RUN_ID,
        advocateVersion: 8,
      }),
    })
  })

  await fillPublicationForm(page)
  const publication = page.getByRole("region", {
    name: "Publish advocate portal",
  })
  await publication
    .getByRole("button", { name: "Start publication check" })
    .click()
  await expect(publication.getByRole("status")).toContainText(
    "could not clear its saved recovery record",
  )
  await expect(
    publication.getByRole("button", { name: "Start publication check" }),
  ).toHaveCount(0)
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      ALPHA_PUBLICATION_STORAGE_KEY,
    ),
  ).not.toBeNull()
})

test("publication never adopts another portal's saved operation", async ({
  page,
}) => {
  const alphaOperationId = "77777777-7777-4777-8777-777777777777"
  await page.evaluate(
    ({ key, advocateId, operationId }) => {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          advocateId,
          operationId,
          expectedVersion: 7,
          adminReason: "Recover the original alpha publication operation.",
          runId: null,
        }),
      )
    },
    {
      key: ALPHA_PUBLICATION_STORAGE_KEY,
      advocateId: ALPHA_ADVOCATE_ID,
      operationId: alphaOperationId,
    },
  )
  const submissions: SubmittedRequest[] = []
  await page.route(/\/publish$/, async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    submissions.push({ url: route.request().url(), body })
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        code: "unauthorized",
        operationId: body.operationId,
      }),
    })
  })
  await page.reload()
  await waitForHarnessHydration(page)
  await expect.poll(() => submissions.length).toBe(1)

  await page.getByRole("button", { name: "Navigate to beta portal" }).click()
  const publication = page.getByRole("region", {
    name: "Publish advocate portal",
  })
  await expect(publication.getByLabel(/Type PUBLISH beta/)).toBeVisible()
  await expect(publication.getByLabel("Administrative reason")).toHaveValue("")
  expect(submissions.length).toBeGreaterThanOrEqual(1)
  for (const submission of submissions) {
    expect(submission.url).toContain(ALPHA_ADVOCATE_ID)
    expect(submission.body.operationId).toBe(alphaOperationId)
  }
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      BETA_PUBLICATION_STORAGE_KEY,
    ),
  ).toBeNull()
})

test("publication ignores a delayed old-portal response after navigation", async ({
  page,
}) => {
  const alphaOperationId = "88888888-8888-4888-8888-888888888888"
  await page.evaluate(
    ({ key, advocateId, operationId }) => {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          advocateId,
          operationId,
          expectedVersion: 7,
          adminReason: "Recover the delayed alpha publication operation.",
          runId: null,
        }),
      )
    },
    {
      key: ALPHA_PUBLICATION_STORAGE_KEY,
      advocateId: ALPHA_ADVOCATE_ID,
      operationId: alphaOperationId,
    },
  )

  let releaseResponse!: () => void
  const responseGate = new Promise<void>((resolveGate) => {
    releaseResponse = resolveGate
  })
  let requestReceived = false
  await page.route(/\/publish$/, async (route) => {
    requestReceived = true
    await responseGate
    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          code: "publication_committed",
          operationId: alphaOperationId,
          runId: PUBLICATION_RUN_ID,
          advocateVersion: 8,
        }),
      })
    } catch {
      // The old request may already be canceled by portal navigation.
    }
  })

  await page.reload()
  await waitForHarnessHydration(page)
  await expect.poll(() => requestReceived).toBe(true)
  await page.getByRole("button", { name: "Navigate to beta portal" }).click()
  releaseResponse()

  const publication = page.getByRole("region", {
    name: "Publish advocate portal",
  })
  await expect(publication.getByLabel(/Type PUBLISH beta/)).toBeVisible()
  await expect(publication.getByLabel("Administrative reason")).toHaveValue("")
  await expect
    .poll(
      async () =>
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          ALPHA_PUBLICATION_STORAGE_KEY,
        ),
    )
    .not.toBeNull()
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      BETA_PUBLICATION_STORAGE_KEY,
    ),
  ).toBeNull()
})
