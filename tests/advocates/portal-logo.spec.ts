import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import sharp from "sharp"

type LogoModule = typeof import("../../src/lib/advocates/admin/logo")
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
  resolve(process.cwd(), "tests/advocates/portal-logo.spec.ts"),
)
const {
  AdvocateLogoProcessingError,
  MAX_ADVOCATE_LOGO_DIMENSION,
  MAX_ADVOCATE_LOGO_MULTIPART_BYTES,
  MAX_ADVOCATE_LOGO_OUTPUT_BYTES,
  MAX_ADVOCATE_LOGO_SOURCE_BYTES,
  isAdvocateLogoMultipartContentType,
  parseAdvocateLogoUploadInput,
  processAdvocateLogo,
  readBoundedAdvocateLogoMultipartBody,
} = testRequire(
  resolve(process.cwd(), "src/lib/advocates/admin/logo.ts"),
) as LogoModule

async function sourcePng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 2400,
      height: 1200,
      channels: 4,
      background: { r: 28, g: 60, b: 140, alpha: 0.8 },
    },
  })
    .withMetadata({
      exif: {
        IFD0: {
          Copyright: "This metadata must not survive",
        },
      },
    })
    .png()
    .toBuffer()
}

async function expectProcessingCode(
  source: Uint8Array,
  code: string,
): Promise<void> {
  try {
    await processAdvocateLogo(source)
    throw new Error("processing unexpectedly succeeded")
  } catch (error) {
    expect(error).toBeInstanceOf(AdvocateLogoProcessingError)
    expect(
      (error as InstanceType<typeof AdvocateLogoProcessingError>).code,
    ).toBe(code)
  }
}

async function multipartRequest(
  overrides: (form: FormData) => void = () => {},
): Promise<Request> {
  const form = new FormData()
  const source = Uint8Array.from(await sourcePng())
  form.set("file", new File([source.buffer], "untrusted-name.png"))
  form.set("expectedVersion", "7")
  form.set("primaryColor", "#1c3c8c")
  form.set("accentColor", "#f4b942")
  form.set("logoAltText", "Hope Creates logo")
  form.set("openingHeaderHtml", "<h1>Welcome</h1>")
  form.set("aboutBiographyHtml", "<h2>About us</h2>")
  form.set("changeReason", "Upload the approved advocate logo.")
  overrides(form)
  return new Request("https://creatorshare.com/api/portal/hope/logo", {
    method: "POST",
    body: form,
  })
}

test.describe("advocate portal logo processing", () => {
  test("content sniffs, rotates, bounds, and transcodes to one WebP", async () => {
    const output = await processAdvocateLogo(await sourcePng())
    expect(output.contentType).toBe("image/webp")
    expect(output.bytes.byteLength).toBeGreaterThan(0)
    expect(output.bytes.byteLength).toBeLessThanOrEqual(
      MAX_ADVOCATE_LOGO_OUTPUT_BYTES,
    )
    expect(output.width).toBeLessThanOrEqual(MAX_ADVOCATE_LOGO_DIMENSION)
    expect(output.height).toBeLessThanOrEqual(MAX_ADVOCATE_LOGO_DIMENSION)
    expect(output.width).toBe(1600)
    expect(output.height).toBe(800)

    const metadata = await sharp(output.bytes).metadata()
    expect(metadata.format).toBe("webp")
    expect(metadata.pages ?? 1).toBe(1)
  })

  test("strips source EXIF, ICC, and XMP metadata", async () => {
    const output = await processAdvocateLogo(await sourcePng())
    const metadata = await sharp(output.bytes).metadata()
    expect(metadata.exif).toBeUndefined()
    expect(metadata.icc).toBeUndefined()
    expect(metadata.xmp).toBeUndefined()
  })

  test("rejects markup and random bytes despite a claimed image filename", async () => {
    await expectProcessingCode(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
      "invalid_source",
    )
    await expectProcessingCode(
      Buffer.from("not really an image"),
      "invalid_source",
    )
    await expectProcessingCode(new Uint8Array(), "invalid_source")

    const unsupportedGif = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 3,
        background: { r: 28, g: 60, b: 140 },
      },
    })
      .gif()
      .toBuffer()
    await expectProcessingCode(unsupportedGif, "unsupported_source")
  })

  test("rejects the source before decoding when its byte budget is exceeded", async () => {
    await expectProcessingCode(
      new Uint8Array(MAX_ADVOCATE_LOGO_SOURCE_BYTES + 1),
      "source_too_large",
    )
  })

  test("preserves transparent pixels without adding a tenant controlled background", async () => {
    const input = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 244, g: 185, b: 66, alpha: 0 },
      },
    })
      .png()
      .toBuffer()
    const output = await processAdvocateLogo(input)
    const metadata = await sharp(output.bytes).metadata()
    expect(metadata.hasAlpha).toBe(true)
  })

  test("bounds and strictly parses the exact multipart upload contract", async () => {
    const request = await multipartRequest()
    const contentType = request.headers.get("content-type")
    expect(isAdvocateLogoMultipartContentType(contentType)).toBe(true)
    const body = await readBoundedAdvocateLogoMultipartBody(request)
    expect(body).not.toBeNull()
    if (body === null || contentType === null) return

    const parsed = await parseAdvocateLogoUploadInput(body, contentType, "hope")
    expect(parsed?.branding).toEqual({
      expectedVersion: 7,
      primaryColor: "#1C3C8C",
      accentColor: "#F4B942",
      logoAltText: "Hope Creates logo",
      openingHeaderHtml: "<h2>Welcome</h2>",
      aboutBiographyHtml: "<h3>About us</h3>",
      changeReason: "Upload the approved advocate logo.",
    })
    expect(parsed?.sourceBytes.byteLength).toBeGreaterThan(0)
  })

  test("rejects multipart field smuggling, duplicates, and nonfiles", async () => {
    for (const mutate of [
      (form: FormData) => form.set("unexpected", "must not cross"),
      (form: FormData) => form.append("primaryColor", "#000000"),
      (form: FormData) => form.set("file", "not a file"),
      (form: FormData) => form.set("expectedVersion", "7.0"),
      (form: FormData) => form.set("logoAltText", ""),
    ]) {
      const request = await multipartRequest(mutate)
      const contentType = request.headers.get("content-type")
      const body = await readBoundedAdvocateLogoMultipartBody(request)
      expect(body).not.toBeNull()
      if (body === null || contentType === null) continue
      await expect(
        parseAdvocateLogoUploadInput(body, contentType, "hope"),
      ).resolves.toBeNull()
    }
  })

  test("rejects malformed multipart media types and oversized declared bodies", async () => {
    for (const value of [
      null,
      "multipart/form-data",
      "multipart/form-data; boundary=",
      "multipart/form-data; boundary=abc; charset=utf-8",
      "application/json; boundary=abc",
    ]) {
      expect(isAdvocateLogoMultipartContentType(value)).toBe(false)
    }

    const request = new Request(
      "https://creatorshare.com/api/portal/hope/logo",
      {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=abc",
          "content-length": String(MAX_ADVOCATE_LOGO_MULTIPART_BYTES + 1),
        },
        body: "--abc--\r\n",
      },
    )
    await expect(
      readBoundedAdvocateLogoMultipartBody(request),
    ).resolves.toBeNull()
  })
})
