import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { rm } from "node:fs/promises"
import { createServer } from "node:net"
import { resolve } from "node:path"

import { expect, test, type Page } from "@playwright/test"

const HARNESS_DIRECTORY = resolve(
  process.cwd(),
  "tests/fixtures/advocate-catalog-harness",
)
const NEXT_EXECUTABLE = resolve(
  process.cwd(),
  "node_modules/next/dist/bin/next",
)
const ALPHA_ID = "11111111-1111-4111-8111-111111111111"
const BETA_ID = "22222222-2222-4222-8222-222222222222"
const GAMMA_ID = "44444444-4444-4444-8444-444444444444"
const REQUEST_ID = "77777777-7777-4777-8777-777777777777"

interface SubmittedCatalogRequest {
  body: Record<string, unknown>
}

let harnessProcess: ChildProcessWithoutNullStreams | null = null
let harnessOrigin = ""
let harnessOutput = ""

// Served by `next dev`, so the first interaction with a not-yet-compiled route
// pays the compile cost inside the test. A shared CI runner is slow enough for
// that to exceed the 30 second default.
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
        reject(new Error("catalog_component_harness_port_unavailable"))
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
      throw new Error(`catalog_component_harness_exited\n${harnessOutput}`)
    }
    try {
      const response = await fetch(origin)
      if (response.ok) return
    } catch {
      // The isolated Next development server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`catalog_component_harness_start_timeout\n${harnessOutput}`)
}

async function removeBlockedSelections(page: Page): Promise<void> {
  const catalog = page.getByRole("region", { name: "Child catalog" })
  await catalog
    .getByRole("button", {
      name: "Remove Unavailable selection 555555555555",
    })
    .click()
  await catalog
    .getByRole("button", { name: "Remove Unavailable selection 333333333333" })
    .click()
}

async function answerHistoryConfirmation(
  page: Page,
  direction: "back" | "forward",
  discard: boolean,
): Promise<string> {
  const dialogPromise = page.waitForEvent("dialog")
  const traversalPromise = page.evaluate((requestedDirection) => {
    if (requestedDirection === "back") window.history.back()
    else window.history.forward()
  }, direction)
  const dialog = await dialogPromise
  expect(dialog.type()).toBe("confirm")
  const message = dialog.message()
  if (discard) await dialog.accept()
  else await dialog.dismiss()
  await traversalPromise.catch(() => undefined)
  return message
}

async function readCatalogDrafts(
  page: Page,
): Promise<readonly [string, string][]> {
  return await page.evaluate(() =>
    Object.entries(window.sessionStorage).filter(([key]) =>
      key.startsWith("creator-share:advocate-catalog-draft:"),
    ),
  )
}

async function installSuccessfulCatalogEndpoint(
  page: Page,
  submissions: SubmittedCatalogRequest[],
  delayMilliseconds = 0,
): Promise<void> {
  await page.route("**/api/portal/catalog-harness/catalog", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    submissions.push({ body })
    if (delayMilliseconds > 0) {
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, delayMilliseconds),
      )
    }
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
        advocateVersion: expectedVersion + 1,
        requestId: REQUEST_ID,
      }),
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

test("operates every catalog mode and repairs, searches, reorders, and features real rendered controls", async ({
  page,
}) => {
  const catalog = page.getByRole("region", { name: "Child catalog" })
  const save = catalog.getByRole("button", { name: "Save child catalog" })

  await expect(catalog.getByText("Former Child", { exact: true })).toHaveCount(
    0,
  )
  await expect(catalog.getByRole("alert")).toContainText(
    "Remove every unavailable child before saving",
  )
  await catalog.getByLabel("Change note").fill("Repair the saved selection")
  await expect(save).toBeDisabled()

  await removeBlockedSelections(page)
  await expect(catalog.getByRole("alert")).toHaveCount(0)
  await expect(save).toBeEnabled()

  await catalog.getByLabel("Find a child to add").fill("gamma")
  await catalog.getByRole("button", { name: "Add Gamma Child" }).click()
  await expect(catalog.getByText(/^3 of 5 selected\./)).toBeVisible()

  await catalog.getByRole("button", { name: "Move Beta Child up" }).click()
  await expect(catalog.locator("p.sr-only")).toHaveText(
    "Beta Child moved to position 1 of 3.",
  )
  await catalog.getByRole("checkbox", { name: "Feature Beta Child" }).uncheck()

  await catalog
    .getByRole("radio", {
      name: /Show every child and feature chosen children/,
    })
    .check()
  await expect(catalog.getByText("Featured", { exact: true })).toHaveCount(3)
  await expect(catalog.getByRole("checkbox")).toHaveCount(0)

  await catalog
    .getByRole("radio", { name: /Show every eligible child/ })
    .check()
  await expect(
    catalog.getByText("New eligible children will appear automatically"),
  ).toBeVisible()
  await expect(
    catalog.getByRole("heading", { name: "Chosen children" }),
  ).toHaveCount(0)

  await catalog
    .getByRole("radio", { name: /Show only chosen children/ })
    .check()
  await expect(
    catalog.getByRole("checkbox", { name: "Feature Beta Child" }),
  ).not.toBeChecked()
  await expect(catalog.getByText("1. Beta Child")).toBeVisible()
  await expect(catalog.getByText("2. Alpha Child")).toBeVisible()
  await expect(catalog.getByText("3. Gamma Child")).toBeVisible()
})

test("restores meaningful focus and announces add and remove changes", async ({
  page,
}) => {
  const catalog = page.getByRole("region", { name: "Child catalog" })
  const liveStatus = catalog.locator("p.sr-only")

  await catalog
    .getByRole("button", { name: "Remove Unavailable selection 333333333333" })
    .click()
  await expect(
    catalog.getByRole("button", { name: "Remove Beta Child" }),
  ).toBeFocused()
  await expect(liveStatus).toHaveText(
    "Unavailable selection 333333333333 removed. 3 of 5 selected.",
  )

  const search = catalog.getByLabel("Find a child to add")
  await search.fill("gamma")
  await catalog.getByRole("button", { name: "Add Gamma Child" }).click()
  await expect(search).toBeFocused()
  await expect(liveStatus).toHaveText("Gamma Child added. 4 of 5 selected.")

  await catalog.getByRole("button", { name: "Remove Beta Child" }).click()
  await expect(
    catalog.getByRole("button", { name: "Remove Gamma Child" }),
  ).toBeFocused()
})

test("submits exact ordered state, accepts one-version success, and uses the new version on the next save", async ({
  page,
}) => {
  const submissions: SubmittedCatalogRequest[] = []
  await installSuccessfulCatalogEndpoint(page, submissions)
  const catalog = page.getByRole("region", { name: "Child catalog" })

  await removeBlockedSelections(page)
  await catalog.getByLabel("Change note").fill("Remove unavailable children")
  await catalog.getByRole("button", { name: "Save child catalog" }).click()

  await expect(
    catalog.getByText("Child catalog saved.", { exact: true }),
  ).toBeVisible()
  await expect(catalog.getByText("You have unsaved changes.")).toHaveCount(0)
  await expect(catalog.getByLabel("Change note")).toHaveValue("")
  expect(submissions).toHaveLength(1)
  expect(submissions[0].body).toEqual({
    expectedVersion: 7,
    mode: "selected",
    beneficiaryIds: [ALPHA_ID, BETA_ID],
    featuredBeneficiaryIds: [BETA_ID],
    changeReason: "Remove unavailable children",
  })

  const search = catalog.getByLabel("Find a child to add")
  await search.fill("gamma")
  await catalog.getByRole("button", { name: "Add Gamma Child" }).click()
  await expect(search).toBeFocused()
  await catalog.getByLabel("Change note").fill("Add Gamma to the catalog")
  await catalog.getByRole("button", { name: "Save child catalog" }).click()
  await expect.poll(() => submissions.length).toBe(2)
  expect(submissions[1].body).toMatchObject({
    expectedVersion: 8,
    beneficiaryIds: [ALPHA_ID, BETA_ID, GAMMA_ID],
    changeReason: "Add Gamma to the catalog",
  })
})

test("collapses same-tick duplicate submission attempts into one request", async ({
  page,
}) => {
  const submissions: SubmittedCatalogRequest[] = []
  await installSuccessfulCatalogEndpoint(page, submissions, 250)
  const catalog = page.getByRole("region", { name: "Child catalog" })
  await removeBlockedSelections(page)
  await catalog.getByLabel("Change note").fill("Submit this update once")

  const save = catalog.getByRole("button", { name: "Save child catalog" })
  await save.evaluate((button: HTMLButtonElement) => {
    button.click()
    button.click()
  })

  await expect(
    catalog.getByText("Child catalog saved.", { exact: true }),
  ).toBeVisible()
  expect(submissions).toHaveLength(1)
})

test("locks editing after an optimistic-concurrency conflict", async ({
  page,
}) => {
  await page.route("**/api/portal/catalog-harness/catalog", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        code: "version_conflict",
        requestId: REQUEST_ID,
      }),
    })
  })
  const catalog = page.getByRole("region", { name: "Child catalog" })
  await removeBlockedSelections(page)
  await catalog.getByLabel("Change note").fill("Attempt a stale update")
  await catalog.getByRole("button", { name: "Save child catalog" }).click()

  await expect(catalog.getByText("Reload required")).toBeVisible()
  await expect(
    catalog.getByText(
      "These catalog settings changed in another session. Reload the latest settings before making another change.",
    ),
  ).toBeVisible()
  await expect(catalog.getByLabel("Change note")).toBeDisabled()
  await expect(
    catalog.getByRole("button", { name: "Reload latest settings" }),
  ).toBeVisible()
})

test("protects unsaved changes across browser unload and client navigation with a modal focus boundary", async ({
  page,
}) => {
  const catalog = page.getByRole("region", { name: "Child catalog" })
  const analytics = page.getByRole("link", { name: "Analytics", exact: true })
  await catalog
    .getByRole("button", { name: "Remove Unavailable selection 333333333333" })
    .click()

  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }),
  ).toBe(true)

  await analytics.click()
  const dialog = page.getByRole("alertdialog", {
    name: "Discard unsaved catalog changes?",
  })
  await expect(dialog).toHaveJSProperty("open", true)
  const stay = dialog.getByRole("button", { name: "Stay on this page" })
  const discard = dialog.getByRole("button", { name: "Discard changes" })
  await expect(stay).toBeFocused()
  await analytics.evaluate((element) => element.focus())
  await expect(stay).toBeFocused()
  await page.keyboard.press("Shift+Tab")
  await expect(discard).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(stay).toBeFocused()

  await page.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect(analytics).toBeFocused()

  let externalDialogType = ""
  page.once("dialog", async (browserDialog) => {
    externalDialogType = browserDialog.type()
    await browserDialog.dismiss()
  })
  await page.getByRole("link", { name: "External help" }).click()
  expect(externalDialogType).toBe("beforeunload")
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(harnessOrigin + "/")

  await analytics.click()
  await stay.click()
  await expect(dialog).toHaveCount(0)
  await expect(analytics).toBeFocused()

  await analytics.click()
  await discard.click()
  await expect(page).toHaveURL(`${harnessOrigin}/other`)
  await expect(page.getByText("Analytics destination")).toBeVisible()
})

test("leaves a deliberately clean catalog when confirmed link navigation is canceled", async ({
  page,
}) => {
  const catalog = page.getByRole("region", { name: "Child catalog" })
  const analytics = page.getByRole("link", { name: "Analytics", exact: true })
  await catalog
    .getByRole("button", { name: "Remove Unavailable selection 333333333333" })
    .click()
  await catalog.getByLabel("Change note").fill("Discard this canceled link")
  await expect.poll(() => readCatalogDrafts(page)).toHaveLength(1)

  await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>('a[href="/other"]')
    if (link === null) throw new Error("analytics_link_missing")
    link.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    })
  })

  await analytics.click()
  await page
    .getByRole("alertdialog", { name: "Discard unsaved catalog changes?" })
    .getByRole("button", { name: "Discard changes" })
    .click()

  await expect(page).toHaveURL(harnessOrigin + "/")
  await expect(catalog.getByText(/^4 of 5 selected\./)).toBeVisible()
  await expect(catalog.getByText("You have unsaved changes.")).toHaveCount(0)
  await expect.poll(() => readCatalogDrafts(page)).toEqual([])

  await catalog
    .getByRole("button", { name: "Remove Unavailable selection 333333333333" })
    .click()
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }),
  ).toBe(true)
})

test("flushes the latest account-bound draft during an immediate page hide", async ({
  page,
}) => {
  const catalog = page.getByRole("region", { name: "Child catalog" })
  await catalog
    .getByRole("button", { name: "Remove Unavailable selection 333333333333" })
    .click()

  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-describedby="catalog-change-note-help"]',
    )
    if (input === null) throw new Error("catalog_change_note_missing")
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set
    valueSetter?.call(input, "Persist the very latest mobile edit")
    input.dispatchEvent(new InputEvent("input", { bubbles: true }))
    window.dispatchEvent(new PageTransitionEvent("pagehide"))
  })

  const drafts = await readCatalogDrafts(page)
  expect(drafts).toHaveLength(1)
  expect(drafts[0][0]).toContain(
    ":66666666-6666-4666-8666-666666666666:77777777-7777-4777-8777-777777777777:",
  )
  expect(JSON.parse(drafts[0][1])).toMatchObject({
    schemaVersion: 2,
    advocateId: "77777777-7777-4777-8777-777777777777",
    actorUserId: "66666666-6666-4666-8666-666666666666",
    advocateVersion: 7,
    changeReason: "Persist the very latest mobile edit",
  })
  expect(drafts[0][1]).not.toMatch(
    /sponsor|contact|payment|provider_customer|visitor/i,
  )
})

test("surfaces blocked draft storage while retaining navigation protection", async ({
  page,
}) => {
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("blocked", "SecurityError")
    }
  })
  const catalog = page.getByRole("region", { name: "Child catalog" })
  await catalog
    .getByRole("button", { name: "Remove Unavailable selection 333333333333" })
    .click()

  await expect(
    catalog.getByText(
      "This browser is blocking tab recovery. Save or reset these changes before leaving this page. Supported browser transitions will still ask before discarding them.",
    ),
  ).toBeVisible()
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }),
  ).toBe(true)

  await page.getByRole("link", { name: "Analytics", exact: true }).click()
  await expect(
    page.getByRole("alertdialog", {
      name: "Discard unsaved catalog changes?",
    }),
  ).toBeVisible()
})

test("keeps hash and secondary browsing-context links available without discarding the catalog", async ({
  page,
}) => {
  const catalog = page.getByRole("region", { name: "Child catalog" })
  await catalog
    .getByRole("button", { name: "Remove Unavailable selection 333333333333" })
    .click()
  const dialog = page.getByRole("alertdialog", {
    name: "Discard unsaved catalog changes?",
  })

  await page.getByRole("link", { name: "Catalog heading" }).click()
  await expect(page).toHaveURL(`${harnessOrigin}/#catalog-settings-title`)
  await expect(dialog).toHaveCount(0)
  await expect(catalog.getByText(/^3 of 5 selected\./)).toBeVisible()

  const popupPromise = page.waitForEvent("popup")
  await page.getByRole("link", { name: "Open analytics preview" }).click()
  const popup = await popupPromise
  await expect(popup).toHaveURL(`${harnessOrigin}/other`)
  await popup.close()
  await expect(page).toHaveURL(`${harnessOrigin}/#catalog-settings-title`)
  await expect(dialog).toHaveCount(0)
  await expect(catalog.getByText(/^3 of 5 selected\./)).toBeVisible()
})

test("lets clean Next links and browser history traverse without a custom prompt", async ({
  page,
}) => {
  const dialog = page.getByRole("alertdialog", {
    name: "Discard unsaved catalog changes?",
  })

  await page.getByRole("link", { name: "Analytics", exact: true }).click()
  await expect(page).toHaveURL(`${harnessOrigin}/other`)
  await expect(dialog).toHaveCount(0)

  await page.getByRole("link", { name: "Child catalog" }).click()
  await expect(page).toHaveURL(harnessOrigin + "/")
  await page.evaluate(() => window.history.back())
  await expect(page).toHaveURL(`${harnessOrigin}/other`)
  await expect(dialog).toHaveCount(0)

  await page.evaluate(() => window.history.forward())
  await expect(page).toHaveURL(harnessOrigin + "/")
  await expect(dialog).toHaveCount(0)
})

test("guards browser back traversal and honors stay or discard without a loop", async ({
  page,
}) => {
  await page.getByRole("link", { name: "Analytics", exact: true }).click()
  await page.getByRole("link", { name: "Child catalog" }).click()

  const catalog = page.getByRole("region", { name: "Child catalog" })
  await catalog
    .getByRole("button", { name: "Remove Unavailable selection 333333333333" })
    .click()

  expect(await answerHistoryConfirmation(page, "back", false)).toBe(
    "Discard unsaved catalog changes?",
  )
  await expect(page).toHaveURL(harnessOrigin + "/")
  await expect(catalog.getByText(/^3 of 5 selected\./)).toBeVisible()

  expect(await answerHistoryConfirmation(page, "back", true)).toBe(
    "Discard unsaved catalog changes?",
  )
  await expect(page).toHaveURL(`${harnessOrigin}/other`)
  await expect(page.getByText("Analytics destination")).toBeVisible()
})

test("leaves a deliberately clean catalog when another listener cancels a confirmed history traversal", async ({
  page,
}) => {
  await page.getByRole("link", { name: "Analytics", exact: true }).click()
  await page.getByRole("link", { name: "Child catalog" }).click()
  const catalog = page.getByRole("region", { name: "Child catalog" })
  await catalog
    .getByRole("button", { name: "Remove Unavailable selection 333333333333" })
    .click()
  await catalog.getByLabel("Change note").fill("Discard canceled traversal")
  await expect.poll(() => readCatalogDrafts(page)).toHaveLength(1)

  await page.evaluate(() => {
    const navigation = (window as Window & { navigation?: EventTarget })
      .navigation
    if (navigation === undefined) throw new Error("navigation_api_missing")
    navigation.addEventListener(
      "navigate",
      (rawEvent) => {
        const event = rawEvent as Event & { navigationType?: string }
        if (event.navigationType === "traverse") event.preventDefault()
      },
      { once: true },
    )
  })

  expect(await answerHistoryConfirmation(page, "back", true)).toBe(
    "Discard unsaved catalog changes?",
  )
  await expect(page).toHaveURL(harnessOrigin + "/")
  await expect(catalog.getByText(/^4 of 5 selected\./)).toBeVisible()
  await expect(catalog.getByText("You have unsaved changes.")).toHaveCount(0)
  await expect.poll(() => readCatalogDrafts(page)).toEqual([])

  await catalog
    .getByRole("button", { name: "Remove Unavailable selection 333333333333" })
    .click()
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }),
  ).toBe(true)
})

test("guards browser forward traversal and honors stay or discard without a loop", async ({
  page,
}) => {
  await page.getByRole("link", { name: "Analytics", exact: true }).click()
  await expect(page).toHaveURL(`${harnessOrigin}/other`)
  await page.getByRole("link", { name: "Child catalog" }).click()
  await expect(page).toHaveURL(harnessOrigin + "/")
  await page.evaluate(() => window.history.back())
  await expect(page).toHaveURL(`${harnessOrigin}/other`)
  await page.evaluate(() => window.history.back())
  await expect(page).toHaveURL(harnessOrigin + "/")

  const catalog = page.getByRole("region", { name: "Child catalog" })
  await catalog
    .getByRole("button", { name: "Remove Unavailable selection 333333333333" })
    .click()

  expect(await answerHistoryConfirmation(page, "forward", false)).toBe(
    "Discard unsaved catalog changes?",
  )
  await expect(page).toHaveURL(harnessOrigin + "/")
  await expect(catalog.getByText(/^3 of 5 selected\./)).toBeVisible()

  expect(await answerHistoryConfirmation(page, "forward", true)).toBe(
    "Discard unsaved catalog changes?",
  )
  await expect(page).toHaveURL(`${harnessOrigin}/other`)
  await expect(page.getByText("Analytics destination")).toBeVisible()
})

test("recovers version-bound drafts after mobile WebKit back and forward traversal", async ({
  browserName,
  page,
}) => {
  test.skip(
    process.env.RUN_WEBKIT_BROWSER_INTEGRATION !== "1",
    "Set RUN_WEBKIT_BROWSER_INTEGRATION=1 for the release WebKit gate.",
  )
  expect(browserName).toBe("webkit")

  const unexpectedDialogs: string[] = []
  page.on("dialog", async (dialog) => {
    unexpectedDialogs.push(`${dialog.type()}:${dialog.message()}`)
    await dialog.accept()
  })
  await page.goto(harnessOrigin)
  await page.getByRole("link", { name: "Analytics", exact: true }).click()
  await page.getByRole("link", { name: "Child catalog" }).click()

  const catalog = page.getByRole("region", { name: "Child catalog" })
  await catalog
    .getByRole("button", {
      name: "Remove Unavailable selection 333333333333",
    })
    .click()
  await catalog
    .getByLabel("Change note")
    .fill("Recover this mobile catalog draft")
  await page.evaluate(() => window.history.back())
  await expect(page).toHaveURL(`${harnessOrigin}/other`)
  await expect(page.getByText("Analytics destination")).toBeVisible()

  await page.evaluate(() => window.history.forward())
  await expect(page).toHaveURL(harnessOrigin + "/")
  await expect(
    page.getByText(
      "Recovered unsaved catalog changes from this browser tab. Review and save them, or reset to the saved catalog.",
    ),
  ).toBeVisible()
  await expect(catalog.getByText(/^3 of 5 selected\./)).toBeVisible()
  await expect(catalog.getByLabel("Change note")).toHaveValue(
    "Recover this mobile catalog draft",
  )
  await catalog.getByRole("button", { name: "Reset to saved catalog" }).click()
  await expect(catalog.getByText(/^4 of 5 selected\./)).toBeVisible()

  await page.evaluate(() => window.history.back())
  await expect(page).toHaveURL(`${harnessOrigin}/other`)
  await page.evaluate(() => window.history.back())
  await expect(page).toHaveURL(harnessOrigin + "/")
  await catalog
    .getByRole("button", {
      name: "Remove Unavailable selection 333333333333",
    })
    .click()
  await catalog
    .getByLabel("Change note")
    .fill("Recover this forward navigation draft")

  await page.evaluate(() => window.history.forward())
  await expect(page).toHaveURL(`${harnessOrigin}/other`)
  await page.evaluate(() => window.history.back())
  await expect(page).toHaveURL(harnessOrigin + "/")
  await expect(catalog.getByText(/^3 of 5 selected\./)).toBeVisible()
  await expect(catalog.getByLabel("Change note")).toHaveValue(
    "Recover this forward navigation draft",
  )
  expect(unexpectedDialogs).toEqual([])
})
