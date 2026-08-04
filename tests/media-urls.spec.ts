import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import {
  getPlaceholderImageUrl,
  PERSON_PLACEHOLDER_PATH,
} from "../src/utils/placeholders"
import { STORAGE_BUCKET } from "../src/utils/supabase/buckets"
import {
  getBrowserImageSrc,
  getExternalActivityImageUrl,
  getExternalProfileImageUrl,
  getDirectMediaUrl,
  filterExistingMediaRows,
  type MediaRow,
} from "../src/utils/supabase/media"

const media = {
  id: "image+id#1",
  parent_id: "parent folder",
  type: "IMAGE",
  extension: "jpg",
} as unknown as MediaRow

test.describe("media URL policy", () => {
  test.beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
  })

  test("composes every media URL from the bucket the policies protect", async () => {
    // The bucket name is a cross-module contract: this constant composes every
    // public media URL, and the storage row level security policies name the
    // same bucket literally. Changing one alone yields well-formed URLs that
    // resolve to nothing, or policies that protect a bucket nobody reads, and
    // no test of URL shape can see either.
    expect(STORAGE_BUCKET).toBe("media")
    expect(getDirectMediaUrl(media)).toContain(
      `/storage/v1/object/public/${STORAGE_BUCKET}/`,
    )

    const hardening = await readFile(
      resolve(
        process.cwd(),
        "supabase/migrations/20260716133003_storage_access_hardening.sql",
      ),
      "utf8",
    )
    expect(
      hardening,
      "the storage policies must protect the bucket these URLs are composed from",
    ).toContain(`bucket_id = '${STORAGE_BUCKET}'`)
  })

  test("browser image sources use direct storage URLs", () => {
    const url = getBrowserImageSrc(media)

    expect(url).toContain("/storage/v1/object/public/")
    expect(url).not.toContain("/storage/v1/render/image/")
  })

  test("external profile image URLs use Supabase transforms", () => {
    const url = getExternalProfileImageUrl(media)

    expect(url).toContain("/storage/v1/render/image/public/")
    expect(url).toContain("width=600")
    expect(url).toContain("height=600")
    expect(url).toContain("quality=85")
    expect(url).toContain("resize=cover")
  })

  test("external activity image URLs avoid forced square crops", () => {
    const url = getExternalActivityImageUrl(media)

    expect(url).toContain("/storage/v1/render/image/public/")
    expect(url).toContain("width=600")
    expect(url).toContain("quality=82")
    expect(url).toContain("resize=contain")
    expect(url).not.toContain("height=")
  })

  test("legacy image URLs remain supported", () => {
    expect(getBrowserImageSrc({ image_url: "/placeholder-person.svg" })).toBe(
      "/placeholder-person.svg",
    )
  })

  test("storage path segments are encoded", () => {
    const url = getDirectMediaUrl(media)

    expect(url).toContain("/parent%20folder/IMAGE/image%2Bid%231.jpg")
  })

  test("placeholder URLs avoid localhost for external services", () => {
    expect(getPlaceholderImageUrl("http://localhost:3000")).toBe(
      `https://creator-share-www.vercel.app${PERSON_PLACEHOLDER_PATH}`,
    )
  })

  test("checks each storage folder once instead of fanning out per media row", async () => {
    const rows = [
      { ...media, id: "one", parent_id: "parent-a" },
      { ...media, id: "two", parent_id: "parent-a" },
      { ...media, id: "missing", parent_id: "parent-a" },
      { ...media, id: "three", parent_id: "parent-b" },
    ] as MediaRow[]
    const calls: Array<{ path: string; offset: number | undefined }> = []
    const client = {
      storage: {
        from: () => ({
          async list(
            path: string,
            options?: { limit?: number; offset?: number },
          ) {
            calls.push({ path, offset: options?.offset })
            return {
              data:
                path === "parent-a/IMAGE"
                  ? [{ name: "one.jpg" }, { name: "two.jpg" }]
                  : [{ name: "three.jpg" }],
              error: null,
            }
          },
        }),
      },
    }

    await expect(filterExistingMediaRows(client, rows)).resolves.toEqual([
      rows[0],
      rows[1],
      rows[3],
    ])
    expect(calls).toHaveLength(2)
    expect(calls.map((call) => call.path).sort()).toEqual([
      "parent-a/IMAGE",
      "parent-b/IMAGE",
    ])
  })
})
