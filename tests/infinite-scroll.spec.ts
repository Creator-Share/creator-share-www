import { test, expect } from "@playwright/test"

test.describe("Infinite Scroll Tests", () => {
  test("infinite scroll loads more items without duplicate keys", async ({
    page,
  }) => {
    const consoleErrors: string[] = []
    const consoleWarnings: string[] = []

    // Capture all console messages
    page.on("console", (msg) => {
      const text = msg.text()
      if (msg.type() === "error") {
        consoleErrors.push(text)
        console.error("❌ CONSOLE ERROR:", text)
      }
      if (msg.type() === "warning") {
        consoleWarnings.push(text)
        console.warn("⚠️  CONSOLE WARNING:", text)
      }
    })

    const initialResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/beneficiaries/get") &&
        response.request().method() === "GET",
    )
    const documentResponse = await page.goto("http://localhost:3000", {
      waitUntil: "domcontentloaded",
    })
    expect(documentResponse?.status()).toBe(200)
    expect((await initialResponse).status()).toBe(200)
    await expect(
      page.getByRole("heading", { name: /One child at a time/i }),
    ).toBeVisible()

    // Count initial beneficiary cards - they're in a SimpleGrid with rounded-[20px] class
    const initialCards = await page
      .locator(".rounded-\\[20px\\].bg-white")
      .count()

    // Get initial IDs from the card containers
    const initialIds = await page
      .locator(".rounded-\\[20px\\].bg-white")
      .evaluateAll((elements) => elements.map((el) => el.id).filter((id) => id))

    const nextPageResponse = page
      .waitForResponse(
        (response) =>
          response.url().includes("/api/beneficiaries/get") &&
          response.url().includes("cursor="),
        { timeout: 5_000 },
      )
      .catch(() => null)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    const response = await nextPageResponse
    if (response !== null) {
      expect(response.status()).toBe(200)

      const afterScrollCards = await page
        .locator(".rounded-\\[20px\\].bg-white")
        .count()

      const afterScrollIds = await page
        .locator(".rounded-\\[20px\\].bg-white")
        .evaluateAll((elements) =>
          elements.map((el) => el.id).filter((id) => id),
        )

      const idSet = new Set(afterScrollIds)
      if (idSet.size !== afterScrollIds.length) {
        const duplicates = afterScrollIds.filter(
          (id, index) => afterScrollIds.indexOf(id) !== index,
        )
        console.error(`🚨 DUPLICATE IDs IN DOM:`, duplicates)
        throw new Error(
          `Found ${
            afterScrollIds.length - idSet.size
          } duplicate ID(s) in the DOM: ${duplicates.join(", ")}`,
        )
      }

      expect(afterScrollCards).toBeGreaterThanOrEqual(initialCards)

      const duplicateKeyErrors = consoleErrors.filter(
        (error) =>
          error.includes("Encountered two children with the same key") ||
          error.includes("duplicate"),
      )

      if (duplicateKeyErrors.length > 0) {
        console.error("🚨 DUPLICATE KEY ERRORS FOUND:")
        duplicateKeyErrors.forEach((error) => console.error(`  - ${error}`))
      }

      expect(duplicateKeyErrors).toHaveLength(0)
    }
  })

  test("loading spinner appears during load", async ({ page }) => {
    const beneficiaryResponse = page.waitForResponse((response) =>
      response.url().includes("/api/beneficiaries/get"),
    )
    const documentResponse = await page.goto("http://localhost:3000", {
      waitUntil: "domcontentloaded",
    })

    const spinner = page.locator('[data-scope="spinner"]').first()

    expect(documentResponse?.status()).toBe(200)
    expect((await beneficiaryResponse).status()).toBe(200)
    await expect(
      page.getByRole("heading", { name: /One child at a time/i }),
    ).toBeVisible()

    await expect(spinner).not.toBeVisible()
  })
})
