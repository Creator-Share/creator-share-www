import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  getPayPalApiUrl,
  PAYPAL_LIVE_API_URL,
  PAYPAL_SANDBOX_API_URL,
} from "../../src/lib/paypal/client"

test.describe.configure({ mode: "serial" })

test("PayPal API configuration accepts only the exact trusted origins", () => {
  const original = process.env.PAYPAL_API_URL
  try {
    delete process.env.PAYPAL_API_URL
    expect(getPayPalApiUrl()).toBe(PAYPAL_LIVE_API_URL)

    for (const url of [PAYPAL_LIVE_API_URL, PAYPAL_SANDBOX_API_URL]) {
      process.env.PAYPAL_API_URL = url
      expect(getPayPalApiUrl()).toBe(url)
    }

    for (const url of [
      `${PAYPAL_LIVE_API_URL}/`,
      `${PAYPAL_LIVE_API_URL}/v1/oauth2/token`,
      `${PAYPAL_SANDBOX_API_URL}?redirect=example.test`,
      "https://example.test",
      "http://api-m.paypal.com",
    ]) {
      process.env.PAYPAL_API_URL = url
      expect(() => getPayPalApiUrl()).toThrow("PayPal API URL is invalid")
    }
  } finally {
    if (original === undefined) delete process.env.PAYPAL_API_URL
    else process.env.PAYPAL_API_URL = original
  }
})

test("the shared PayPal client has no legacy raw provider lookup or cancellation path", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/lib/paypal/client.ts"),
    "utf8",
  )

  expect(source).not.toContain("getPayPalOrder")
  expect(source).not.toContain("PayPalOrderResponse")
  expect(source).not.toContain("cancelPayPalSubscription")
  expect(source).not.toContain("errorText")
  expect(source).not.toContain("response.text()")
})
