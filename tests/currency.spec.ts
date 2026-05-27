import { expect, test } from "@playwright/test"
import {
  convertCurrencyMinorToUsdCents,
  convertUsdCentsToCurrency,
  formatMoneyFromMinorUnits,
  getDefaultCurrencyForCountry,
} from "../src/utils/currency"
import { getStripeRegionForPaymentCurrency } from "../src/lib/stripe/currencyRouting"

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

  test("converts canonical USD cents with static rates and explicit minor units", () => {
    expect(convertUsdCentsToCurrency(1000, "USD")).toMatchObject({
      baseAmountUsdCents: 1000,
      chargedAmountMinor: 1000,
      chargedCurrency: "USD",
      chargedCurrencyMinorUnit: 2,
    })
    expect(convertUsdCentsToCurrency(1000, "AUD")).toMatchObject({
      baseAmountUsdCents: 1000,
      chargedAmountMinor: 1500,
      chargedCurrency: "AUD",
      chargedCurrencyMinorUnit: 2,
    })
    expect(convertUsdCentsToCurrency(1000, "GBP")).toMatchObject({
      chargedAmountMinor: 800,
      chargedCurrency: "GBP",
    })
    expect(convertUsdCentsToCurrency(1000, "EUR")).toMatchObject({
      chargedAmountMinor: 900,
      chargedCurrency: "EUR",
    })
  })

  test("converts selected currency input back to canonical USD cents", () => {
    expect(convertCurrencyMinorToUsdCents(1500, "AUD")).toBe(1000)
    expect(convertCurrencyMinorToUsdCents(800, "GBP")).toBe(1000)
    expect(convertCurrencyMinorToUsdCents(900, "EUR")).toBe(1000)
  })

  test("honors environment rate overrides", () => {
    const previous = process.env.USD_TO_AUD_RATE
    process.env.USD_TO_AUD_RATE = "2"
    try {
      expect(convertUsdCentsToCurrency(1000, "AUD")).toMatchObject({
        chargedAmountMinor: 2000,
        conversionRate: 2,
        conversionRateSource: "env",
      })
    } finally {
      if (previous === undefined) delete process.env.USD_TO_AUD_RATE
      else process.env.USD_TO_AUD_RATE = previous
    }
  })

  test("formats charged provider amounts with their actual currency", () => {
    expect(formatMoneyFromMinorUnits(1500, "AUD")).toMatch(/A?\$15\.00|15\.00/)
    expect(formatMoneyFromMinorUnits(800, "GBP")).toContain("8.00")
    expect(formatMoneyFromMinorUnits(900, "EUR")).toContain("9.00")
  })

  test("routes only USD to the US Stripe account", () => {
    expect(getStripeRegionForPaymentCurrency("USD")).toBe("us")
    expect(getStripeRegionForPaymentCurrency("AUD")).toBe("uk")
    expect(getStripeRegionForPaymentCurrency("GBP")).toBe("uk")
    expect(getStripeRegionForPaymentCurrency("EUR")).toBe("uk")
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
