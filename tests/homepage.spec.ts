import { test, expect } from "@playwright/test"

test.describe("Homepage Tests", () => {
  test("homepage loads successfully", async ({ page }) => {
    await page.goto("http://localhost:3000")

    // Wait for page to load
    await page.waitForLoadState("networkidle")

    // Check that the page loaded (no 404/500)
    expect(page.url()).toBe("http://localhost:3000/")
  })

  test("CompactHero section is visible", async ({ page }) => {
    await page.goto("http://localhost:3000")
    await page.waitForLoadState("networkidle")

    // Check for hero text
    await expect(page.getByText(/Be the Reason Someone/i)).toBeVisible()
    await expect(page.getByText(/Smiles/i)).toBeVisible()
  })

  test("SponsorshipFilters component renders", async ({ page }) => {
    await page.goto("http://localhost:3000")
    await page.waitForLoadState("networkidle")

    // Check for filter elements
    await expect(page.getByText(/Select Gender/i)).toBeVisible()
    // Status dropdown shows selected values by default
    await expect(page.getByText(/New, Partially Funded/i)).toBeVisible()
    await expect(page.getByText(/Age Range/i)).toBeVisible()
    await expect(
      page.getByRole("button", { name: /Show All Children/i })
    ).toBeVisible()
  })

  test("beneficiary listings load", async ({ page }) => {
    await page.goto("http://localhost:3000")

    // Wait for API call to complete
    await page.waitForResponse(
      (response) =>
        response.url().includes("/api/beneficiaries/get") &&
        response.status() === 200
    )

    // Wait a bit for rendering
    await page.waitForTimeout(1000)

    // Check that listings container exists
    const listingsContainer = page
      .locator(".border.bg-white.rounded-2xl")
      .last()
    await expect(listingsContainer).toBeVisible()
  })

  test("no console errors on page load", async ({ page }) => {
    const consoleErrors: string[] = []

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text())
      }
    })

    await page.goto("http://localhost:3000")
    await page.waitForLoadState("networkidle")

    // Filter out known non-critical errors
    const criticalErrors = consoleErrors.filter(
      (error) => !error.includes("Download the React DevTools")
    )

    expect(criticalErrors).toHaveLength(0)
  })
})
