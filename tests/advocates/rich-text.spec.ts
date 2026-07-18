import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type AdvocateRichTextModule = typeof import("../../src/lib/advocates/richText")
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
  resolve(process.cwd(), "tests/advocates/rich-text.spec.ts"),
)
const richText = testRequire(
  "../../src/lib/advocates/richText",
) as AdvocateRichTextModule
nodeModule._load = originalModuleLoad

const {
  ADVOCATE_RICH_TEXT_ALLOWED_TAGS,
  ADVOCATE_RICH_TEXT_MAX_INPUT_BYTES,
  AdvocateRichTextValidationError,
  sanitizeAdvocateRichText,
  validateCanonicalAdvocateRichText,
} = richText

test.describe("advocate rich text boundary", () => {
  test("is explicitly unavailable to client bundles", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/advocates/richText.ts"),
      "utf8",
    )

    expect(source.startsWith('import "server-only"')).toBe(true)
  })

  test("exposes exactly the intentionally small element allowlist", () => {
    expect(ADVOCATE_RICH_TEXT_ALLOWED_TAGS).toEqual([
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
    ])
  })

  test("preserves canonical allowed markup and normalizes malformed markup", () => {
    const canonical =
      "<h1>Welcome</h1><p>Join <strong>our</strong> <em>family</em>.<br /></p><blockquote><b>Together</b></blockquote><ul><li>Care</li></ul><ol><li>Share</li></ol><h2>About</h2><h3>Today</h3>"

    expect(sanitizeAdvocateRichText(canonical)).toBe(canonical)
    expect(sanitizeAdvocateRichText("<p><strong>Safe</p> text")).toBe(
      "<p><strong>Safe</strong></p> text",
    )
  })

  test("removes every attribute, including styling and tracking surfaces", () => {
    const sanitized = sanitizeAdvocateRichText(
      '<p id="hero" class="lead" style="background:url(https://tracker.example/pixel)" onclick="steal()" data-tracker="abc"><strong title="secret">Safe</strong></p>',
    )

    expect(sanitized).toBe("<p><strong>Safe</strong></p>")
    expect(sanitized).not.toMatch(
      /id=|class=|style=|onclick=|data-|title=|https?:/i,
    )
  })

  test("allows no links, images, forms, embeds, SVG, scripts, or URL attributes", () => {
    const sanitized = sanitizeAdvocateRichText(
      '<p>Keep <a href="javascript:alert(1)">this</a>.</p>' +
        '<img src="https://tracker.example/pixel" onerror="steal()">' +
        '<form action="https://evil.example"><p>Form text</p><input name="email"></form>' +
        '<script src="https://evil.example/x.js">alert(1)</script>' +
        "<style>p{background:url(https://tracker.example)}</style>" +
        '<iframe src="https://evil.example">frame text</iframe>' +
        '<object data="https://evil.example">object text</object>' +
        '<embed src="https://evil.example">' +
        '<svg><a href="https://evil.example"><text>svg text</text></a></svg>',
    )

    expect(sanitized).toBe("<p>Keep this.</p><p>Form text</p>")
    expect(sanitized).not.toMatch(
      /<a|<img|<form|<input|<script|<style|<iframe|<object|<embed|<svg|href=|src=|action=|https?:|javascript:/i,
    )
  })

  test("removes comments and document metadata", () => {
    expect(
      sanitizeAdvocateRichText(
        '<!doctype html><!-- tracker --><head><meta http-equiv="refresh" content="0;url=https://evil.example"><title>Hidden</title></head><p>Visible</p>',
      ),
    ).toBe("<p>Visible</p>")
  })

  test("is idempotent", () => {
    const once = sanitizeAdvocateRichText(
      '<DIV><P class="lead">Hello <i>there</i></P></DIV>',
    )

    expect(sanitizeAdvocateRichText(once)).toBe(once)
  })

  test("accepts only an exact canonical value at write boundaries", () => {
    const canonical = "<p>Hello <strong>family</strong>.</p>"

    expect(validateCanonicalAdvocateRichText(canonical)).toEqual({
      ok: true,
      value: canonical,
    })

    for (const nonCanonical of [
      '<p class="lead">Hello</p>',
      "<P>Hello</P>",
      "<div><p>Hello</p></div>",
      '<p>Hello<a href="https://evil.example">link</a></p>',
      "<p>Hello<br></p>",
    ]) {
      expect(validateCanonicalAdvocateRichText(nonCanonical)).toEqual({
        ok: false,
        code: "not_canonical",
        message: "Advocate rich text must use canonical allowed markup",
      })
    }
  })

  test("rejects non-string input without serializing or echoing it", () => {
    const secret = "do-not-echo-this-value"
    const input = { secret, toString: () => secret }
    const validation = validateCanonicalAdvocateRichText(input)

    expect(validation).toEqual({
      ok: false,
      code: "invalid_type",
      message: "Advocate rich text must be a string",
    })
    expect(JSON.stringify(validation)).not.toContain(secret)

    expect(() => sanitizeAdvocateRichText(input)).toThrow(
      AdvocateRichTextValidationError,
    )
    try {
      sanitizeAdvocateRichText(input)
    } catch (error) {
      expect(error).toMatchObject({
        name: "AdvocateRichTextValidationError",
        code: "invalid_type",
        message: "Advocate rich text must be a string",
      })
      expect(String(error)).not.toContain(secret)
    }
  })

  test("enforces the UTF-8 byte limit without echoing oversized content", () => {
    const exactAsciiLimit = "a".repeat(ADVOCATE_RICH_TEXT_MAX_INPUT_BYTES)
    const oversizedSecret =
      "sensitive-oversized-content-" +
      "a".repeat(ADVOCATE_RICH_TEXT_MAX_INPUT_BYTES)
    const exactMultibyteLimit = "é".repeat(
      ADVOCATE_RICH_TEXT_MAX_INPUT_BYTES / 2,
    )
    const oversizedMultibyte = `${exactMultibyteLimit}é`

    expect(sanitizeAdvocateRichText(exactAsciiLimit)).toBe(exactAsciiLimit)
    expect(sanitizeAdvocateRichText(exactMultibyteLimit)).toBe(
      exactMultibyteLimit,
    )

    for (const oversized of [oversizedSecret, oversizedMultibyte]) {
      const validation = validateCanonicalAdvocateRichText(oversized)
      expect(validation).toEqual({
        ok: false,
        code: "input_too_large",
        message: "Advocate rich text exceeds the maximum input size",
      })
      expect(JSON.stringify(validation)).not.toContain(oversized)

      try {
        sanitizeAdvocateRichText(oversized)
        throw new Error("Expected oversized rich text to be rejected")
      } catch (error) {
        expect(error).toMatchObject({
          name: "AdvocateRichTextValidationError",
          code: "input_too_large",
          message: "Advocate rich text exceeds the maximum input size",
        })
        expect(String(error)).not.toContain(oversized)
      }
    }
  })
})
