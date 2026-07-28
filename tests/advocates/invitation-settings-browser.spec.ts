import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { once } from "node:events"
import { rm } from "node:fs/promises"
import { createServer } from "node:net"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import { preserveFile } from "../support/preserve-file"

/**
 * The invitation idempotency key, and what happens when an operator corrects a
 * mistyped recipient.
 *
 * No test loaded this component: a reachability probe that appended a throwing
 * statement to it and ran the complete offline lane passed unchanged. That
 * left one specific behaviour unguarded.
 *
 * The key is minted before the POST and cleared only on a fully successful
 * response, so it survives an error or a lost response where the server may
 * already have committed the invitation. Editing the recipient must therefore
 * discard it. Without that, an operator who mistypes an address, sees the
 * failure, corrects the address and resubmits reuses the stale key. The server
 * replays the original row, returns the ORIGINAL invited address, and the UI
 * reports success. The corrected recipient is never invited, an invitation to
 * the mistyped address stays live for seven days, and nothing signals it.
 *
 * The server cannot tell a legitimate exact retry from a changed-payload
 * replay, which is what makes this client-side reset the only guard.
 */

const workspace = process.cwd()
const harnessDirectory = resolve(
  workspace,
  "tests/fixtures/advocate-invitation-settings-harness",
)
const nextExecutable = resolve(workspace, "node_modules/next/dist/bin/next")

let harnessProcess: ChildProcessWithoutNullStreams | null = null
let harnessOutput = ""
let harnessBuildDirectory = ""
let harnessOrigin = ""
let restoreHarnessConfig: () => Promise<void> = async () => {}

function harnessEnvironment(distDirectory: string) {
  return {
    ...process.env,
    CHECKOUT_HARNESS_DIST_DIR: distDirectory,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "invitation-harness-anon-key",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_TELEMETRY_DISABLED: "1",
  }
}

function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address === null || typeof address === "string") {
        server.close()
        reject(new Error("invitation_harness_port_unavailable"))
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
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (
      harnessProcess?.exitCode !== null ||
      harnessProcess?.signalCode !== null
    ) {
      throw new Error(
        `invitation_harness_exited\n${harnessOutput.slice(-8_000)}`,
      )
    }
    try {
      const response = await fetch(origin)
      if (response.ok) return
    } catch {
      // The isolated fixture is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  throw new Error(
    `invitation_harness_start_timeout\n${harnessOutput.slice(-8_000)}`,
  )
}

async function stopHarness(): Promise<void> {
  const child = harnessProcess
  harnessProcess = null
  if (child === null || child.exitCode !== null || child.signalCode !== null) {
    return
  }
  child.kill("SIGTERM")
  await Promise.race([
    once(child, "exit"),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ])
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL")
    await once(child, "exit")
  }
}

test.describe.configure({ mode: "serial" })

test.beforeAll(async ({}, workerInfo) => {
  test.setTimeout(300_000)
  harnessOutput = ""
  restoreHarnessConfig = await preserveFile(
    resolve(harnessDirectory, "tsconfig.json"),
  )
  const distDirectory = `.next-worker-${workerInfo.workerIndex}`
  harnessBuildDirectory = resolve(harnessDirectory, distDirectory)
  await rm(harnessBuildDirectory, { recursive: true, force: true })

  const build = spawn(
    process.execPath,
    [nextExecutable, "build", harnessDirectory],
    { cwd: workspace, env: harnessEnvironment(distDirectory), stdio: "pipe" },
  )
  build.stdout.on("data", (chunk: Buffer) => {
    harnessOutput += chunk.toString()
  })
  build.stderr.on("data", (chunk: Buffer) => {
    harnessOutput += chunk.toString()
  })
  const [buildExitCode] = (await once(build, "exit")) as [number | null]
  if (buildExitCode !== 0) {
    throw new Error(
      `invitation_harness_build_failed\n${harnessOutput.slice(-8_000)}`,
    )
  }

  const port = await reservePort()
  harnessOrigin = `http://127.0.0.1:${port}`
  harnessProcess = spawn(
    process.execPath,
    [
      nextExecutable,
      "start",
      harnessDirectory,
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: workspace, env: harnessEnvironment(distDirectory), stdio: "pipe" },
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
    await stopHarness()
    await rm(harnessBuildDirectory, { recursive: true, force: true })
    await restoreHarnessConfig()
    throw error
  }
})

test.afterAll(async () => {
  try {
    await stopHarness()
  } finally {
    await rm(harnessBuildDirectory, { recursive: true, force: true })
    await restoreHarnessConfig()
  }
})

interface IssuedRequest {
  email: string
  idempotencyKey: string
}

/** Fails every invitation POST, which is what keeps the key retained. */
async function openFormWithFailingServer(
  page: import("@playwright/test").Page,
) {
  const issued: IssuedRequest[] = []
  await page.route("**/api/portal/*/team/invitations", async (route) => {
    const body = route.request().postDataJSON() as IssuedRequest
    issued.push({ email: body.email, idempotencyKey: body.idempotencyKey })
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, code: "temporarily_unavailable" }),
    })
  })

  await page.goto(harnessOrigin, { waitUntil: "domcontentloaded" })
  await page.getByLabel("Reason for access").fill("Onboarding a new delegate")
  return issued
}

test("mints a fresh idempotency key when the recipient is corrected", async ({
  page,
}) => {
  const issued = await openFormWithFailingServer(page)
  const emailField = page.getByLabel("Email address")
  const submit = page.getByRole("button", { name: "Send invitation" })

  await emailField.fill("mistyped@exmaple.test")
  await submit.click()
  await expect.poll(() => issued.length).toBe(1)

  // The operator notices the typo and corrects it.
  await emailField.fill("correct@example.test")
  await submit.click()
  await expect.poll(() => issued.length).toBe(2)

  expect(issued[0].email).toBe("mistyped@exmaple.test")
  expect(issued[1].email).toBe("correct@example.test")

  // The decisive assertion. Reusing the first key lets the server replay the
  // original row and answer with the mistyped address, which the UI would
  // report as a successful invitation to the corrected one.
  expect(issued[1].idempotencyKey).not.toBe(issued[0].idempotencyKey)
})

test("reuses the idempotency key for an unchanged retry", async ({ page }) => {
  const issued = await openFormWithFailingServer(page)
  const submit = page.getByRole("button", { name: "Send invitation" })

  await page.getByLabel("Email address").fill("stable@example.test")
  await submit.click()
  await expect.poll(() => issued.length).toBe(1)

  // Same recipient, same roles, same reason: this is the exact retry the key
  // exists for, and it must not create a second invitation.
  await submit.click()
  await expect.poll(() => issued.length).toBe(2)

  expect(issued[1].idempotencyKey).toBe(issued[0].idempotencyKey)
})

test("mints a fresh key when the roles or the reason change", async ({
  page,
}) => {
  const issued = await openFormWithFailingServer(page)
  const submit = page.getByRole("button", { name: "Send invitation" })

  await page.getByLabel("Email address").fill("stable@example.test")
  await submit.click()
  await expect.poll(() => issued.length).toBe(1)

  // Roles and reason are part of the invitation the server would replay, so
  // changing either must also discard the retained key.
  await page.getByLabel("Reason for access").fill("Different justification")
  await submit.click()
  await expect.poll(() => issued.length).toBe(2)
  expect(issued[1].idempotencyKey).not.toBe(issued[0].idempotencyKey)
})
