import { expect, test } from "@playwright/test"
import {
  convertCurrencyMinorToUsdCents,
  convertUsdCentsToCurrency,
  formatMoney,
  getDefaultCurrencyForCountry,
} from "../src/utils/currency"
import {
  getStripeRegionForPaymentCurrency,
  getStripeRegionForPaymentMetadata,
} from "../src/lib/stripe/currencyRouting"

test.describe("payment currency support", () => {
  test("maps supported countries to the expected default currencies", () => {
    expect(getDefaultCurrencyForCountry("US")).toBe("USD")
    expect(getDefaultCurrencyForCountry("AU")).toBe("AUD")
    expect(getDefaultCurrencyForCountry("NZ")).toBe("AUD")
    expect(getDefaultCurrencyForCountry("GB")).toBe("GBP")
    expect(getDefaultCurrencyForCountry("UK")).toBe("GBP")
    expect(getDefaultCurrencyForCountry("IE")).toBe("EUR")
    expect(getDefaultCurrencyForCountry("DE")).toBe("EUR")
    expect(getDefaultCurrencyForCountry("TZ")).toBe("USD")
  })

  test("converts canonical USD cents with configured rates", () => {
    const now = Date.now()
    expect(convertUsdCentsToCurrency(1000, "USD")).toMatchObject({
      baseAmountUsdCents: 1000,
      chargedAmountMinor: 1000,
      chargedCurrency: "USD",
    })
    expect(convertUsdCentsToCurrency(1000, "AUD")).toMatchObject({
      baseAmountUsdCents: 1000,
      chargedAmountMinor: 1400,
      chargedCurrency: "AUD",
    })
    expect(convertUsdCentsToCurrency(1000, "GBP")).toMatchObject({
      chargedAmountMinor: 740,
      chargedCurrency: "GBP",
    })
    expect(convertUsdCentsToCurrency(1000, "EUR")).toMatchObject({
      chargedAmountMinor: 860,
      chargedCurrency: "EUR",
    })
  })

  test("converts foreign currency minor units back to canonical USD cents", () => {
    expect(convertCurrencyMinorToUsdCents(1400, "AUD")).toBe(1000)
    expect(convertCurrencyMinorToUsdCents(740, "GBP")).toBe(1000)
    expect(convertCurrencyMinorToUsdCents(860, "EUR")).toBe(1000)
  })

  test("uses configured rates from config/rates.ts", () => {
    expect(convertUsdCentsToCurrency(1000, "AUD")).toMatchObject({
      chargedAmountMinor: 1400,
      conversionRate: 1.40,
    })
  })

  test("formats charged provider amounts with their actual currency", () => {
    expect(formatMoney(1500, "AUD")).toMatch(/A?\$15\.00|15\.00/)
    expect(formatMoney(800, "GBP")).toContain("8.00")
    expect(formatMoney(900, "EUR")).toContain("9.00")
  })

  test("routes only USD to the US Stripe account", () => {
    expect(getStripeRegionForPaymentCurrency("USD")).toBe("us")
    expect(getStripeRegionForPaymentCurrency("AUD")).toBe("uk")
    expect(getStripeRegionForPaymentCurrency("GBP")).toBe("uk")
    expect(getStripeRegionForPaymentCurrency("EUR")).toBe("uk")
  })

  test("prefers checkout metadata region over legacy webhook route fallback", () => {
    expect(getStripeRegionForPaymentMetadata({ region: "uk" }, "us")).toBe(
      "uk",
    )
    expect(getStripeRegionForPaymentMetadata({ region: "us" }, "uk")).toBe(
      "us",
    )
    expect(getStripeRegionForPaymentMetadata({ region: "nope" }, "us")).toBe(
      "us",
    )
    expect(getStripeRegionForPaymentMetadata(null, "uk")).toBe("uk")
  })

  test("currency detection endpoint reads the Vercel country header", async ({
    request,
  }) => {
    const response = await request.get("/api/payments/currency", {
      headers: { "x-vercel-ip-country": "NZ" },
    })
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    expect(body).toEqual(
      expect.objectContaining({
        country: "NZ",
        currency: "AUD",
        currencies: ["USD", "AUD", "GBP", "EUR"],
      }),
    )
  })
})
