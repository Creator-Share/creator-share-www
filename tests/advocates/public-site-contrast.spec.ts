import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

/**
 * Accessible colour derivation, and the bucket a tenant logo actually lives in.
 *
 * Two mutations left the whole suite green. Swapping the WCAG red and blue
 * luminance coefficients still returns plausible black or white foregrounds
 * and still satisfies the implementation's own arithmetic, so nothing that
 * merely re-uses `contrastRatio` can detect it. These assertions instead pin
 * the coefficients against the published WCAG values and recompute contrast
 * independently, so the test does not agree with a broken implementation.
 *
 * Separately, the public logo bucket constant is a cross-module contract: the
 * upload route writes to one bucket and this module composes the public URL
 * from another constant. Changing either alone yields a well-formed URL that
 * resolves to nothing, and every advocate portal loses its logo at once.
 */

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(process.cwd(), "tests/advocates/public-site-contrast.spec.ts"),
)
const theme = testRequire(
  "../../src/lib/advocates/publicSiteTheme",
) as typeof import("../../src/lib/advocates/publicSiteTheme")
const presentation = testRequire(
  "../../src/lib/advocates/publicPresentation",
) as typeof import("../../src/lib/advocates/publicPresentation")
nodeModule._load = originalModuleLoad

/** WCAG 2.1 relative luminance, written independently of the implementation. */
function referenceLuminance(hex: string): number {
  const channel = (start: number) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

function referenceContrast(left: string, right: string): number {
  const a = referenceLuminance(left)
  const b = referenceLuminance(right)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

test.describe("accessible public site colours", () => {
  test("uses the published WCAG channel coefficients", async () => {
    // Pure red and pure blue are the decisive pair: each linearizes to 1.0, so
    // its luminance is exactly its own coefficient. Swapping red and blue is
    // invisible to anything that reuses the implementation's own arithmetic,
    // and immediately visible here.
    expect(theme.relativeLuminance("#FF0000")).toBeCloseTo(0.2126, 6)
    expect(theme.relativeLuminance("#0000FF")).toBeCloseTo(0.0722, 6)
    expect(theme.relativeLuminance("#00FF00")).toBeCloseTo(0.7152, 6)

    expect(theme.relativeLuminance("#FFFFFF")).toBeCloseTo(1, 6)
    expect(theme.relativeLuminance("#000000")).toBeCloseTo(0, 6)
  })

  test("agrees with an independent contrast computation", async () => {
    for (const [left, right] of [
      ["#FFFFFF", "#000000"],
      ["#2B7FF9", "#FFFFFF"],
      ["#F59E0B", "#000000"],
      ["#0000FF", "#FFFFFF"],
      ["#FF0000", "#FFFFFF"],
    ] as const) {
      expect(
        theme.contrastRatio(left, right),
        `${left} against ${right}`,
      ).toBeCloseTo(referenceContrast(left, right), 6)
    }
  })

  test("chooses the foreground that genuinely reads on the brand colour", async () => {
    // Verified against the independent computation rather than against the
    // implementation, so a broken luminance cannot satisfy both sides.
    for (const background of [
      "#2B7FF9",
      "#F59E0B",
      "#0000FF",
      "#FF0000",
      "#FFFFFF",
      "#000000",
      "#767676",
    ]) {
      const chosen = theme.deriveAccessibleForegroundColor(background)
      const alternative = chosen === "#000000" ? "#FFFFFF" : "#000000"

      expect(
        referenceContrast(background, chosen),
        `${background} should prefer ${chosen}`,
      ).toBeGreaterThanOrEqual(referenceContrast(background, alternative))
    }
  })

  test("derives brand ink that meets the text contrast floor", async () => {
    for (const primary of ["#2B7FF9", "#F59E0B", "#FFFF00", "#00FF00"]) {
      const ink = theme.deriveAccessibleBrandInkColor(primary)
      // The light surface the ink is placed on.
      expect(
        referenceContrast(ink, "#FFFFFF"),
        `${primary} ink ${ink} must remain readable`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})

test.describe("public advocate logo location", () => {
  test("composes logo URLs from the bucket the upload route writes to", async () => {
    // This constant is half of a cross-module contract. If it and the upload
    // route disagree, every portal emits a well-formed URL that resolves to
    // nothing, and the failure is invisible to any test that only checks the
    // URL's shape.
    expect(presentation.PUBLIC_ADVOCATE_LOGO_BUCKET).toBe("advocate-assets")

    const routeSource = await readFile(
      resolve(process.cwd(), "src/app/api/portal/[slug]/logo/route.ts"),
      "utf8",
    )
    expect(
      routeSource,
      "the upload route must write to the bucket the public URL is composed from",
    ).toContain(
      `const LOGO_BUCKET = "${presentation.PUBLIC_ADVOCATE_LOGO_BUCKET}"`,
    )
  })
})
