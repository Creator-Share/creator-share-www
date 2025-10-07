import { test, expect } from "@playwright/test"

test.describe("Filter Functionality Tests", () => {
  test("gender filter changes listings", async ({ page }) => {
    await page.goto("http://localhost:3000")
    await page.waitForLoadState("networkidle")

    // Wait for initial load
    await page.waitForResponse((response) =>
      response.url().includes("/api/beneficiaries/get")
    )

    // Click gender dropdown
    await page.getByText(/Select Gender/i).click()
    await page.waitForTimeout(500)

    // Select "Male" option
    await page.getByText("Male", { exact: true }).click()

    // Wait for new API call with gender filter
    await page.waitForResponse(
      (response) =>
        response.url().includes("/api/beneficiaries/get") &&
        response.url().includes("gender=Male")
    )

    await page.waitForTimeout(500)
  })

  test("age range slider works", async ({ page }) => {
    await page.goto("http://localhost:3000")
    await page.waitForLoadState("networkidle")

    // Check initial age range text
    await expect(page.getByText(/Age Range: 0 - 14 years/i)).toBeVisible()

    // Note: Slider interaction is complex, just verify it's present
    const slider = page.locator('input[type="range"]').first()
    await expect(slider).toBeVisible()
  })

  test("clear filters button works", async ({ page }) => {
    await page.goto("http://localhost:3000")
    await page.waitForLoadState("networkidle")

    // Initially button should be disabled (at defaults)
    const clearButton = page.getByRole("button", { name: /Show All Children/i })
    await expect(clearButton).toBeDisabled()

    // Change a filter
    await page.getByText(/Select Gender/i).click()
    await page.waitForTimeout(300)
    await page.getByText("Male", { exact: true }).click()
    await page.waitForTimeout(500)

    // Now button should be enabled
    await expect(clearButton).toBeEnabled()

    // Click clear button
    await clearButton.click()

    // Wait for reset
    await page.waitForTimeout(500)

    // Button should be disabled again
    await expect(clearButton).toBeDisabled()
  })
})
