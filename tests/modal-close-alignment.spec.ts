import { test, expect } from "@playwright/test"

/**
 * Validates that the Lucide X inside the modal close IconButton is vertically
 * centered (baseline / line-height quirks otherwise shift the glyph).
 */
test.describe("Modal close control alignment", () => {
  test("Sign In modal: close icon vertically centered in button", async ({
    page,
  }) => {
    await page.goto("/#signin")

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible({ timeout: 20_000 })

    const closeBtn = dialog.getByRole("button", { name: "Close" })
    await expect(closeBtn).toBeVisible()

    const svg = closeBtn.locator("svg").first()
    await expect(svg).toBeVisible()

    const btnBox = await closeBtn.boundingBox()
    const svgBox = await svg.boundingBox()
    expect(btnBox, "close button bounding box").toBeTruthy()
    expect(svgBox, "svg bounding box").toBeTruthy()
    if (!btnBox || !svgBox) return

    const btnCenterY = btnBox.y + btnBox.height / 2
    const svgCenterY = svgBox.y + svgBox.height / 2
    const delta = Math.abs(btnCenterY - svgCenterY)

    expect(
      delta,
      `SVG vertical center (${svgCenterY.toFixed(2)}) should match button center (${btnCenterY.toFixed(2)}), |delta|=${delta.toFixed(2)}px`,
    ).toBeLessThanOrEqual(6)
  })

  test("FAQ modal: close icon vertically centered in button", async ({
    page,
  }) => {
    await page.goto("/#faq")

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible({ timeout: 20_000 })

    const closeBtn = dialog.getByRole("button", { name: "Close" })
    await expect(closeBtn).toBeVisible()

    const svg = closeBtn.locator("svg").first()
    await expect(svg).toBeVisible()

    const btnBox = await closeBtn.boundingBox()
    const svgBox = await svg.boundingBox()
    expect(btnBox, "close button bounding box").toBeTruthy()
    expect(svgBox, "svg bounding box").toBeTruthy()
    if (!btnBox || !svgBox) return

    const btnCenterY = btnBox.y + btnBox.height / 2
    const svgCenterY = svgBox.y + svgBox.height / 2
    const delta = Math.abs(btnCenterY - svgCenterY)

    expect(
      delta,
      `SVG vertical center (${svgCenterY.toFixed(2)}) should match button center (${btnCenterY.toFixed(2)}), |delta|=${delta.toFixed(2)}px`,
    ).toBeLessThanOrEqual(6)
  })
})
