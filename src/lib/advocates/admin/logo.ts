import "server-only"

import sharp from "sharp"

import {
  parseAdvocateBrandingUpdateInput,
  type AdvocateBrandingUpdateInput,
} from "@/lib/advocates/admin/branding"

export const MAX_ADVOCATE_LOGO_SOURCE_BYTES = 5 * 1024 * 1024
export const MAX_ADVOCATE_LOGO_OUTPUT_BYTES = 1024 * 1024
export const MAX_ADVOCATE_LOGO_DIMENSION = 1600
export const MAX_ADVOCATE_LOGO_INPUT_PIXELS = 40_000_000
export const MAX_ADVOCATE_LOGO_MULTIPART_BYTES =
  MAX_ADVOCATE_LOGO_SOURCE_BYTES + 64 * 1024

const ALLOWED_SOURCE_FORMATS = new Set(["jpeg", "png", "webp"])
const OUTPUT_DIMENSIONS = [1600, 1280, 1024, 800] as const
const OUTPUT_QUALITIES = [88, 78, 68, 58] as const

export type AdvocateLogoProcessingErrorCode =
  | "invalid_source"
  | "unsupported_source"
  | "animated_source"
  | "source_too_large"
  | "output_too_large"

export class AdvocateLogoProcessingError extends Error {
  readonly code: AdvocateLogoProcessingErrorCode

  constructor(code: AdvocateLogoProcessingErrorCode) {
    super(code)
    this.name = "AdvocateLogoProcessingError"
    this.code = code
  }
}

export interface ProcessedAdvocateLogo {
  bytes: Buffer
  width: number
  height: number
  contentType: "image/webp"
}

export interface AdvocateLogoUploadInput {
  sourceBytes: Uint8Array
  branding: Omit<AdvocateBrandingUpdateInput, "logoStoragePath">
}

const MULTIPART_FIELD_NAMES = Object.freeze([
  "file",
  "expectedVersion",
  "primaryColor",
  "accentColor",
  "logoAltText",
  "openingHeaderHtml",
  "aboutBiographyHtml",
  "changeReason",
] as const)
const PLACEHOLDER_LOGO_ID = "00000000-0000-4000-8000-000000000000"

export function isAdvocateLogoMultipartContentType(
  value: string | null,
): boolean {
  if (value === null || value.length > 200) return false
  return /^multipart\/form-data;\s*boundary=(?:"[A-Za-z0-9'()+_,.\/:=? -]{1,70}"|[A-Za-z0-9'()+_,.\/:=?-]{1,70})$/i.test(
    value,
  )
}

export async function readBoundedAdvocateLogoMultipartBody(
  request: Pick<Request, "body" | "headers">,
): Promise<Uint8Array | null> {
  const contentLength = request.headers.get("content-length")
  if (
    contentLength !== null &&
    (!/^[0-9]+$/.test(contentLength) ||
      Number(contentLength) > MAX_ADVOCATE_LOGO_MULTIPART_BYTES)
  ) {
    return null
  }
  if (request.body === null) return new Uint8Array()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_ADVOCATE_LOGO_MULTIPART_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function isFile(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.arrayBuffer === "function" &&
    typeof value.size === "number"
  )
}

export async function parseAdvocateLogoUploadInput(
  body: Uint8Array,
  contentType: string,
  advocateSlug: string,
): Promise<AdvocateLogoUploadInput | null> {
  if (
    !(body instanceof Uint8Array) ||
    body.byteLength === 0 ||
    body.byteLength > MAX_ADVOCATE_LOGO_MULTIPART_BYTES ||
    !isAdvocateLogoMultipartContentType(contentType)
  ) {
    return null
  }

  let form: FormData
  try {
    form = await new Response(Uint8Array.from(body).buffer, {
      headers: { "Content-Type": contentType },
    }).formData()
  } catch {
    return null
  }

  const entries = [...form.entries()]
  if (
    entries.length !== MULTIPART_FIELD_NAMES.length ||
    new Set(entries.map(([name]) => name)).size !== entries.length ||
    !MULTIPART_FIELD_NAMES.every((name) => form.has(name))
  ) {
    return null
  }

  const file = form.get("file")
  if (
    file === null ||
    typeof file === "string" ||
    !isFile(file) ||
    file.size < 1 ||
    file.size > MAX_ADVOCATE_LOGO_SOURCE_BYTES
  ) {
    return null
  }

  const stringFields: Record<string, string> = {}
  for (const name of MULTIPART_FIELD_NAMES) {
    if (name === "file") continue
    const value = form.get(name)
    if (typeof value !== "string") return null
    stringFields[name] = value
  }
  if (!/^[1-9][0-9]{0,15}$/.test(stringFields.expectedVersion ?? "")) {
    return null
  }
  const expectedVersion = Number(stringFields.expectedVersion)
  if (!Number.isSafeInteger(expectedVersion)) return null

  const canonical = parseAdvocateBrandingUpdateInput(
    JSON.stringify({
      expectedVersion,
      primaryColor: stringFields.primaryColor,
      accentColor: stringFields.accentColor,
      logoStoragePath: `logos/${advocateSlug}/${PLACEHOLDER_LOGO_ID}.webp`,
      logoAltText: stringFields.logoAltText,
      openingHeaderHtml: stringFields.openingHeaderHtml,
      aboutBiographyHtml: stringFields.aboutBiographyHtml,
      changeReason: stringFields.changeReason,
    }),
    advocateSlug,
  )
  if (canonical === null || canonical.logoAltText === null) return null

  let sourceBytes: Uint8Array
  try {
    sourceBytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return null
  }
  if (
    sourceBytes.byteLength !== file.size ||
    sourceBytes.byteLength < 1 ||
    sourceBytes.byteLength > MAX_ADVOCATE_LOGO_SOURCE_BYTES
  ) {
    return null
  }

  const branding: Omit<AdvocateBrandingUpdateInput, "logoStoragePath"> = {
    expectedVersion: canonical.expectedVersion,
    primaryColor: canonical.primaryColor,
    accentColor: canonical.accentColor,
    logoAltText: canonical.logoAltText,
    openingHeaderHtml: canonical.openingHeaderHtml,
    aboutBiographyHtml: canonical.aboutBiographyHtml,
    changeReason: canonical.changeReason,
  }
  return { sourceBytes, branding }
}

function sourceBuffer(value: Uint8Array): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new AdvocateLogoProcessingError("invalid_source")
  }
  if (value.byteLength > MAX_ADVOCATE_LOGO_SOURCE_BYTES) {
    throw new AdvocateLogoProcessingError("source_too_large")
  }
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
}

function processor(bytes: Buffer) {
  return sharp(bytes, {
    animated: false,
    failOn: "warning",
    limitInputPixels: MAX_ADVOCATE_LOGO_INPUT_PIXELS,
    sequentialRead: true,
  })
}

async function inspectSource(bytes: Buffer): Promise<void> {
  let metadata: sharp.Metadata
  try {
    metadata = await processor(bytes).metadata()
  } catch {
    throw new AdvocateLogoProcessingError("invalid_source")
  }

  if (!metadata.format || !ALLOWED_SOURCE_FORMATS.has(metadata.format)) {
    throw new AdvocateLogoProcessingError("unsupported_source")
  }
  if ((metadata.pages ?? 1) !== 1) {
    throw new AdvocateLogoProcessingError("animated_source")
  }
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width < 1 ||
    metadata.height < 1 ||
    metadata.width * metadata.height > MAX_ADVOCATE_LOGO_INPUT_PIXELS
  ) {
    throw new AdvocateLogoProcessingError("invalid_source")
  }
}

async function transcode(
  source: Buffer,
  dimension: number,
  quality: number,
): Promise<ProcessedAdvocateLogo | null> {
  try {
    const { data, info } = await processor(source)
      .rotate()
      .resize({
        width: dimension,
        height: dimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({
        quality,
        alphaQuality: 90,
        effort: 4,
        smartSubsample: true,
      })
      .toBuffer({ resolveWithObject: true })

    if (
      info.format !== "webp" ||
      info.width < 1 ||
      info.height < 1 ||
      info.width > MAX_ADVOCATE_LOGO_DIMENSION ||
      info.height > MAX_ADVOCATE_LOGO_DIMENSION ||
      data.byteLength < 1 ||
      data.byteLength > MAX_ADVOCATE_LOGO_OUTPUT_BYTES
    ) {
      return null
    }

    return {
      bytes: data,
      width: info.width,
      height: info.height,
      contentType: "image/webp",
    }
  } catch {
    throw new AdvocateLogoProcessingError("invalid_source")
  }
}

/**
 * Decodes untrusted source bytes, applies orientation, strips all metadata,
 * bounds dimensions, and emits one nonanimated immutable WebP payload.
 */
export async function processAdvocateLogo(
  source: Uint8Array,
): Promise<ProcessedAdvocateLogo> {
  const bytes = sourceBuffer(source)
  await inspectSource(bytes)

  for (const dimension of OUTPUT_DIMENSIONS) {
    for (const quality of OUTPUT_QUALITIES) {
      const output = await transcode(bytes, dimension, quality)
      if (output !== null) return output
    }
  }

  throw new AdvocateLogoProcessingError("output_too_large")
}
