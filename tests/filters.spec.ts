import { test, expect } from "@playwright/test"

test.describe("Filter Functionality Tests", () => {
  test("gender filter changes listings", async ({ page }) => {
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

    await page.getByRole("combobox").filter({ hasText: "All Genders" }).click()

    const filteredResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/beneficiaries/get") &&
        response.url().includes("gender=Boy"),
    )
    await page.getByRole("option", { name: "Boys", exact: true }).click()
    expect((await filteredResponse).status()).toBe(200)
    await expect(
      page.getByRole("combobox").filter({ hasText: "Boys" }),
    ).toBeVisible()
  })

  test("age range slider works", async ({ page }) => {
    const response = await page.goto("http://localhost:3000", {
      waitUntil: "domcontentloaded",
    })

    expect(response?.status()).toBe(200)
    await expect(page.getByText(/Age:\s*0.*14\s*yrs/i)).toBeVisible()

    const slider = page.getByRole("slider").first()
    await expect(slider).toBeVisible()
  })

  test("clear filters button works", async ({ page }) => {
    const initialResponse = page.waitForResponse((response) =>
      response.url().includes("/api/beneficiaries/get"),
    )
    const documentResponse = await page.goto("http://localhost:3000", {
      waitUntil: "domcontentloaded",
    })
    expect(documentResponse?.status()).toBe(200)
    expect((await initialResponse).status()).toBe(200)

    await page.getByRole("combobox").filter({ hasText: "All Genders" }).click()
    const filteredResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/beneficiaries/get") &&
        response.url().includes("gender=Boy"),
    )
    await page.getByRole("option", { name: "Boys", exact: true }).click()
    expect((await filteredResponse).status()).toBe(200)

    const clearButton = page
      .getByRole("button", { name: "show all", exact: true })
      .first()
    await expect(clearButton).toBeEnabled()

    const resetResponse = page.waitForResponse((response) => {
      if (!response.url().includes("/api/beneficiaries/get")) return false
      return !new URL(response.url()).searchParams.has("gender")
    })
    await clearButton.click()
    expect((await resetResponse).status()).toBe(200)

    await expect(
      page.getByRole("combobox").filter({ hasText: "All Genders" }),
    ).toBeVisible()
  })
})
