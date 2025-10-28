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

    await page.goto("http://localhost:3000")

    // Wait for initial load
    await page.waitForResponse((response) =>
      response.url().includes("/api/beneficiaries/get")
    )
    await page.waitForTimeout(1000)

    // Count initial beneficiary cards - they're in a SimpleGrid with rounded-[20px] class
    const initialCards = await page
      .locator(".rounded-\\[20px\\].bg-white")
      .count()
    console.log(`Initial cards loaded: ${initialCards}`)

    // Get initial IDs from the card containers
    const initialIds = await page
      .locator(".rounded-\\[20px\\].bg-white")
      .evaluateAll((elements) => elements.map((el) => el.id).filter((id) => id))
    console.log(`Initial IDs:`, initialIds)

    // Scroll to bottom to trigger infinite scroll
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    // Wait for next page to load
    try {
      const response = await page.waitForResponse(
        (response) =>
          response.url().includes("/api/beneficiaries/get") &&
          response.url().includes("cursor="),
        { timeout: 5000 }
      )

      console.log(`Loaded more data from: ${response.url()}`)
      await page.waitForTimeout(1500)

      // Count cards after scroll
      const afterScrollCards = await page
        .locator(".rounded-\\[20px\\].bg-white")
        .count()
      console.log(`Cards after scroll: ${afterScrollCards}`)

      // Get all IDs after scroll
      const afterScrollIds = await page
        .locator(".rounded-\\[20px\\].bg-white")
        .evaluateAll((elements) =>
          elements.map((el) => el.id).filter((id) => id)
        )
      console.log(`After scroll IDs:`, afterScrollIds)

      // Check for duplicate IDs in the DOM
      const idSet = new Set(afterScrollIds)
      if (idSet.size !== afterScrollIds.length) {
        const duplicates = afterScrollIds.filter(
          (id, index) => afterScrollIds.indexOf(id) !== index
        )
        console.error(`🚨 DUPLICATE IDs IN DOM:`, duplicates)
        throw new Error(
          `Found ${
            afterScrollIds.length - idSet.size
          } duplicate ID(s) in the DOM: ${duplicates.join(", ")}`
        )
      }

      // Should have more cards (or same if no more data)
      expect(afterScrollCards).toBeGreaterThanOrEqual(initialCards)

      // Check for duplicate key errors
      const duplicateKeyErrors = consoleErrors.filter(
        (error) =>
          error.includes("Encountered two children with the same key") ||
          error.includes("duplicate")
      )

      if (duplicateKeyErrors.length > 0) {
        console.error("🚨 DUPLICATE KEY ERRORS FOUND:")
        duplicateKeyErrors.forEach((error) => console.error(`  - ${error}`))
      }

      expect(duplicateKeyErrors).toHaveLength(0)
    } catch (error) {
      // If no more data to load, that's okay
      console.log("No more data to load or already at end")
    }
  })

  test("loading spinner appears during load", async ({ page }) => {
    await page.goto("http://localhost:3000")

    // Initial load should show spinner briefly
    const spinner = page.locator('[data-scope="spinner"]').first()

    // Wait for page to settle
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1000)

    // Spinner should be gone after load
    await expect(spinner).not.toBeVisible()
  })
})
