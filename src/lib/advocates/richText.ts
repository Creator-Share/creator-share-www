import "server-only"

import { Buffer } from "node:buffer"

import sanitizeHtml from "sanitize-html"

export const ADVOCATE_RICH_TEXT_MAX_INPUT_BYTES = 16_384

export const ADVOCATE_RICH_TEXT_ALLOWED_TAGS = Object.freeze([
  "p",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "b",
  "br",
  "blockquote",
] as const)

export type AdvocateRichTextValidationCode =
  | "invalid_type"
  | "input_too_large"
  | "not_canonical"

export type AdvocateRichTextValidationResult =
  | { ok: true; value: string }
  | {
      ok: false
      code: AdvocateRichTextValidationCode
      message: string
    }

const VALIDATION_MESSAGES: Record<AdvocateRichTextValidationCode, string> = {
  invalid_type: "Advocate rich text must be a string",
  input_too_large: "Advocate rich text exceeds the maximum input size",
  not_canonical: "Advocate rich text must use canonical allowed markup",
}

const NON_TEXT_TAGS = Object.freeze([
  "script",
  "style",
  "textarea",
  "option",
  "xmp",
  "noscript",
  "template",
  "head",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "svg",
  "math",
  "video",
  "audio",
  "picture",
  "canvas",
] as const)

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = Object.freeze({
  allowedTags: [...ADVOCATE_RICH_TEXT_ALLOWED_TAGS],
  allowedAttributes: {},
  allowedClasses: {},
  allowedStyles: {},
  allowedSchemes: [],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: [],
  allowedIframeDomains: [],
  allowedIframeHostnames: [],
  allowedScriptDomains: [],
  allowedScriptHostnames: [],
  allowIframeRelativeUrls: false,
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  nonTextTags: [...NON_TEXT_TAGS],
  parseStyleAttributes: false,
  nestingLimit: 32,
  selfClosing: ["br"],
})

const OPENING_HEADER_SANITIZE_OPTIONS: sanitizeHtml.IOptions = Object.freeze({
  ...SANITIZE_OPTIONS,
  transformTags: {
    h1: "h2",
    h2: "h2",
    h3: "h2",
  },
})

const ABOUT_BIOGRAPHY_SANITIZE_OPTIONS: sanitizeHtml.IOptions = Object.freeze({
  ...SANITIZE_OPTIONS,
  transformTags: {
    h1: "h3",
    h2: "h3",
    h3: "h3",
  },
})

function inputValidationCode(
  value: unknown,
): Extract<
  AdvocateRichTextValidationCode,
  "invalid_type" | "input_too_large"
> | null {
  if (typeof value !== "string") return "invalid_type"

  if (
    value.length > ADVOCATE_RICH_TEXT_MAX_INPUT_BYTES ||
    Buffer.byteLength(value, "utf8") > ADVOCATE_RICH_TEXT_MAX_INPUT_BYTES
  ) {
    return "input_too_large"
  }

  return null
}

function failure(
  code: AdvocateRichTextValidationCode,
): Extract<AdvocateRichTextValidationResult, { ok: false }> {
  return { ok: false, code, message: VALIDATION_MESSAGES[code] }
}

export class AdvocateRichTextValidationError extends Error {
  readonly code: AdvocateRichTextValidationCode

  constructor(code: AdvocateRichTextValidationCode) {
    super(VALIDATION_MESSAGES[code])
    this.name = "AdvocateRichTextValidationError"
    this.code = code
  }
}

export function sanitizeAdvocateRichText(value: unknown): string {
  const invalidInput = inputValidationCode(value)
  if (invalidInput) throw new AdvocateRichTextValidationError(invalidInput)

  return sanitizeHtml(value as string, SANITIZE_OPTIONS)
}

/**
 * The page shell owns its one h1. Tenant-authored opening headings therefore
 * begin at h2 regardless of which toolbar heading level produced the input.
 */
export function sanitizeAdvocateOpeningHeaderRichText(value: unknown): string {
  const invalidInput = inputValidationCode(value)
  if (invalidInput) throw new AdvocateRichTextValidationError(invalidInput)

  return sanitizeHtml(value as string, OPENING_HEADER_SANITIZE_OPTIONS)
}

/**
 * The dialog title is h2. Biography headings are normalized beneath it so a
 * tenant cannot introduce another page h1 or skip the dialog hierarchy.
 */
export function sanitizeAdvocateAboutBiographyRichText(value: unknown): string {
  const invalidInput = inputValidationCode(value)
  if (invalidInput) throw new AdvocateRichTextValidationError(invalidInput)

  return sanitizeHtml(value as string, ABOUT_BIOGRAPHY_SANITIZE_OPTIONS)
}

export function validateCanonicalAdvocateRichText(
  value: unknown,
): AdvocateRichTextValidationResult {
  const invalidInput = inputValidationCode(value)
  if (invalidInput) return failure(invalidInput)

  const canonicalValue = sanitizeHtml(value as string, SANITIZE_OPTIONS)
  if (canonicalValue !== value) return failure("not_canonical")

  return { ok: true, value: canonicalValue }
}
