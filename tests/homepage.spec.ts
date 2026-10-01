import { test, expect } from "@playwright/test"

test.describe("Homepage Tests", () => {
  test("homepage loads successfully", async ({ page }) => {
    const response = await page.goto("http://localhost:3000", {
      waitUntil: "domcontentloaded",
    })

    expect(response?.status()).toBe(200)
    expect(page.url()).toBe("http://localhost:3000/")
    await expect(
      page.getByRole("heading", { name: /One child at a time/i }),
    ).toBeVisible()
  })

  test("home hero is visible", async ({ page }) => {
    const response = await page.goto("http://localhost:3000", {
      waitUntil: "domcontentloaded",
    })

    expect(response?.status()).toBe(200)
    await expect(
      page.getByRole("heading", { name: /One child at a time/i }),
    ).toBeVisible()
    await expect(page.getByText(/thousands of lives/i)).toBeVisible()
  })

  test("SponsorshipFilters component renders", async ({ page }) => {
    const response = await page.goto("http://localhost:3000", {
      waitUntil: "domcontentloaded",
    })

    expect(response?.status()).toBe(200)
    await expect(
      page.getByRole("combobox").filter({ hasText: "All Genders" }),
    ).toBeVisible()
    await expect(page.getByText(/Age:\s*0.*14\s*yrs/i)).toBeVisible()
    await expect(page.getByPlaceholder("Search")).toBeVisible()

    await expect(
      page.locator(
        '[data-scope="select"][data-part="root"]#select\\:sponsorship-beneficiary-type-filter',
      ),
    ).toBeVisible()
    await expect(
      page.locator(
        '[data-scope="select"][data-part="root"]#select\\:sponsorship-gender-filter',
      ),
    ).toBeVisible()
    await expect(
      page.locator(
        '[data-scope="slider"][data-part="root"]#slider\\:sponsorship-age-range-filter',
      ),
    ).toBeVisible()
  })

  test("beneficiary listings load", async ({ page }) => {
    const beneficiaryResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/beneficiaries/get") &&
        response.request().method() === "GET",
    )
    const documentResponse = await page.goto("http://localhost:3000", {
      waitUntil: "domcontentloaded",
    })

    expect(documentResponse?.status()).toBe(200)
    expect((await beneficiaryResponse).status()).toBe(200)

    const catalogResult = page
      .getByText("No matches", { exact: true })
      .or(page.locator(".rounded-\\[20px\\].bg-white").first())
    await expect(catalogResult).toBeVisible()
  })

  test("no console errors on page load", async ({ page }) => {
    const consoleErrors: string[] = []

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text())
      }
    })

    const beneficiaryResponse = page.waitForResponse((response) =>
      response.url().includes("/api/beneficiaries/get"),
    )
    const documentResponse = await page.goto("http://localhost:3000", {
      waitUntil: "domcontentloaded",
    })
    expect(documentResponse?.status()).toBe(200)
    expect((await beneficiaryResponse).status()).toBe(200)
    await expect(
      page.getByRole("heading", { name: /One child at a time/i }),
    ).toBeVisible()

    const criticalErrors = consoleErrors.filter(
      (error) => !error.includes("Download the React DevTools"),
    )

    expect(criticalErrors).toHaveLength(0)
  })
})
