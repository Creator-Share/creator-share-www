import { test, expect } from "@playwright/test"

test.describe("Embed Page Tests", () => {
  test("embed page loads successfully", async ({ page }) => {
    await page.goto("http://localhost:3000/embed")
    await page.waitForLoadState("networkidle")

    expect(page.url()).toBe("http://localhost:3000/embed")
  })

  test("embed page has proper title and description", async ({ page }) => {
    await page.goto("http://localhost:3000/embed")
    await page.waitForLoadState("networkidle")

    // Check for embed page specific content
    await expect(
      page.getByText(/Sponsoring a Child with Creator Share/i)
    ).toBeVisible()
    await expect(
      page.getByText(/brings hope to those facing isolation/i)
    ).toBeVisible()
  })

  test("embed page has filters", async ({ page }) => {
    await page.goto("http://localhost:3000/embed")
    await page.waitForLoadState("networkidle")

    // Check filters are present
    await expect(page.getByText(/Select Gender/i)).toBeVisible()
    await expect(page.getByText(/Age Range/i)).toBeVisible()
  })

  test("embed page with embedded=true parameter hides navbar", async ({
    page,
  }) => {
    await page.goto("http://localhost:3000/embed?embedded=true")
    await page.waitForLoadState("networkidle")

    // Navbar should not be visible when embedded=true
    const navbar = page.locator("nav").first()
    await expect(navbar).not.toBeVisible()
  })

  test("embed page loads beneficiary data", async ({ page }) => {
    await page.goto("http://localhost:3000/embed")

    // Wait for API call
    await page.waitForResponse(
      (response) =>
        response.url().includes("/api/beneficiaries/get") &&
        response.status() === 200
    )

    await page.waitForTimeout(1000)

    // Check that listings container exists
    const listingsContainer = page
      .locator(".border.bg-white.rounded-2xl")
      .last()
    await expect(listingsContainer).toBeVisible()
  })
})
