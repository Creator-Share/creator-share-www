import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import { resolveMapTileProvider } from "../../src/lib/maps/tileProvider"

test("exact staging never sends a copied MapTiler key", () => {
  const provider = resolveMapTileProvider("bright-v2", {
    NEXT_PUBLIC_BASE_URL: "https://advocate-staging.creatorshare.com",
    NEXT_PUBLIC_MAPTILER_KEY: "CopiedProductionMapTilerKey",
  })

  expect(provider.url).toContain("tile.openstreetmap.org")
  expect(provider.url).not.toContain("CopiedProductionMapTilerKey")
  expect(provider.attribution).toContain("OpenStreetMap")
})

test("production keeps a valid configured MapTiler provider", () => {
  expect(
    resolveMapTileProvider("basic-v2", {
      NEXT_PUBLIC_BASE_URL: "https://creatorshare.com",
      NEXT_PUBLIC_MAPTILER_KEY: "production_maptiler_key",
    }),
  ).toEqual({
    attribution: '&copy; <a href="https://www.maptiler.com/">MapTiler</a>',
    url: "https://api.maptiler.com/maps/basic-v2/{z}/{x}/{y}.png?key=production_maptiler_key&lang=en",
  })
})

test("map components contain no literal provider key", () => {
  for (const path of [
    "src/app/(admin)/admin/beneficiaries/components/MapPicker.tsx",
    "src/app/sponsorships/components/SponsorshipMap/index.tsx",
  ]) {
    const source = readFileSync(resolve(process.cwd(), path), "utf8")
    expect(source).toContain("resolveMapTileProvider")
    expect(source).not.toMatch(/key=[A-Za-z0-9_-]{16,}/)
  }
})
