import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { once } from "node:events"
import { rm } from "node:fs/promises"
import { createServer } from "node:net"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import { preserveFile } from "../support/preserve-file"

/**
 * Renders a real advocate-branded document.
 *
 * A completion audit found that no test ever rendered one:
 * `data-public-site-kind` was asserted only for the payment shell, and the
 * branded surface was covered by reading component source text, which cannot
 * catch a component that stops rendering what it imports or a provider that
 * stops emitting the site kind. These assertions run against the DOM.
 *
 * The fixture is built and served in production mode. `next dev` compiles
 * lazily and can serve transient manifest failures, which produced days of
 * misattributed flakiness elsewhere in this suite.
 */

const workspace = process.cwd()
const harnessDirectory = resolve(
  workspace,
  "tests/fixtures/advocate-public-site-harness",
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
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-site-harness-anon-key",
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
        reject(new Error("public_site_harness_port_unavailable"))
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
        `public_site_harness_exited\n${harnessOutput.slice(-8_000)}`,
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
    `public_site_harness_start_timeout\n${harnessOutput.slice(-8_000)}`,
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
      `public_site_harness_build_failed\n${harnessOutput.slice(-8_000)}`,
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

test("renders an advocate-branded document with its approved branding", async ({
  page,
}) => {
  await page.goto(harnessOrigin, { waitUntil: "domcontentloaded" })

  // The site kind reaches the DOM. Previously asserted only for the payment
  // shell, so an advocate document emitting the wrong kind went unnoticed.
  const shell = page.locator('[data-public-site-kind="advocate"]')
  await expect(shell).toHaveCount(1)

  // Both approved colours arrive as CSS variables rather than being inlined
  // into arbitrary styles.
  const variables = await shell.evaluate((element) => {
    const style = window.getComputedStyle(element)
    return {
      accent: style.getPropertyValue("--public-site-accent").trim(),
      primary: style.getPropertyValue("--public-site-primary").trim(),
    }
  })
  // Uppercase is the contract, not an accident: normalizePublicSiteColor
  // canonicalises hex before it reaches the document, so a lowercase value
  // arriving here would mean the normaliser was bypassed.
  expect(variables.primary).toBe("#2B7FF9")
  expect(variables.accent).toBe("#F59E0B")

  // Opening rich text and About Us rich text both render as markup.
  await expect(
    page
      .getByRole("region", { name: "Opening header" })
      .getByText("Welcome from Hope Partners"),
  ).toBeVisible()
  await expect(
    page.getByRole("region", { name: "Opening header" }).locator("strong"),
  ).toHaveText("Hope Partners")
  await expect(
    page
      .getByRole("region", { name: "About Us" })
      .getByText("We have supported children since 2019."),
  ).toBeVisible()

  // The logo renders with its alt text, which is the accessible half of the
  // branding allowlist.
  const logo = page.getByRole("img", { name: "Hope Partners logo" })
  await expect(logo).toBeVisible()
  await expect(logo).toHaveAttribute(
    "src",
    "https://cdn.example.test/hope-partners/logo.png",
  )
})

test("keeps sponsor, tenant, and provider material out of the branded document", async ({
  page,
}) => {
  await page.goto(harnessOrigin, { waitUntil: "domcontentloaded" })
  await expect(page.locator('[data-public-site-kind="advocate"]')).toHaveCount(
    1,
  )

  // PublicSite is the only tenant presentation object crossing to the client,
  // and it is documented as carrying no tenant IDs, sponsor data, or provider
  // metadata. Assert that against the delivered document rather than trusting
  // the type, since a future field would cross silently.
  const html = await page.content()
  for (const forbidden of [
    "@example",
    "advocateId",
    "membership",
    "service_role",
    "sponsor",
    "stripe",
    "supabase",
  ]) {
    expect(
      html.toLowerCase().includes(forbidden.toLowerCase()),
      `branded document must not contain ${forbidden}`,
    ).toBe(false)
  }
})
