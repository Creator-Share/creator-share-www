import { test, expect } from "@playwright/test"

test.describe("Embed Page Tests", () => {
  test("embed page loads successfully", async ({ page }) => {
    const response = await page.goto("http://localhost:3000/embed", {
      waitUntil: "domcontentloaded",
    })

    expect(response?.status()).toBe(200)
    expect(page.url()).toBe("http://localhost:3000/embed")
    await expect(
      page.getByText(/Sponsoring a Child with Creator Share/i),
    ).toBeVisible()
  })

  test("embed page has proper title and description", async ({ page }) => {
    const response = await page.goto("http://localhost:3000/embed", {
      waitUntil: "domcontentloaded",
    })

    expect(response?.status()).toBe(200)
    await expect(
      page.getByText(/Sponsoring a Child with Creator Share/i),
    ).toBeVisible()
    await expect(
      page.getByText(/brings hope to those facing isolation/i),
    ).toBeVisible()
  })

  test("embed page has filters", async ({ page }) => {
    const response = await page.goto("http://localhost:3000/embed", {
      waitUntil: "domcontentloaded",
    })

    expect(response?.status()).toBe(200)
    await expect(
      page.getByRole("combobox").filter({ hasText: "All Genders" }),
    ).toBeVisible()
    await expect(page.getByText(/Age:\s*0.*14\s*yrs/i)).toBeVisible()
    await expect(page.getByPlaceholder("Search")).toBeVisible()
  })

  test("embed page with embedded=true parameter hides navbar", async ({
    page,
  }) => {
    const response = await page.goto(
      "http://localhost:3000/embed?embedded=true",
      { waitUntil: "domcontentloaded" },
    )

    expect(response?.status()).toBe(200)
    await expect(
      page.getByText(/Sponsoring a Child with Creator Share/i),
    ).toBeVisible()
    const navbar = page.locator("nav").first()
    await expect(navbar).not.toBeVisible()
  })

  test("embed page loads beneficiary data", async ({ page }) => {
    const beneficiaryResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/beneficiaries/get") &&
        response.request().method() === "GET",
    )
    const documentResponse = await page.goto("http://localhost:3000/embed", {
      waitUntil: "domcontentloaded",
    })

    expect(documentResponse?.status()).toBe(200)
    expect((await beneficiaryResponse).status()).toBe(200)

    const listingsContainer = page
      .locator(".border.bg-white.rounded-2xl")
      .last()
    await expect(listingsContainer).toBeVisible()
  })
})
