export const dollarsToCents = (dollars: number): string => {
  return Math.round(Math.max(0, dollars) * 100).toString()
}

export const centsToDollars = (cents: number): string => {
  return (cents / 100).toFixed(2)
}

export const formatUsdCents = (cents: number | null | undefined): string => {
  return formatMoneyFromMinorUnits(cents || 0, "USD")
}

export const SUPPORTED_CURRENCIES = ["USD", "AUD", "GBP", "EUR"] as const

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

export const DEFAULT_SUPPORTED_CURRENCY: SupportedCurrency = "USD"
export const CURRENCY_CONFIG_VERSION = "2026-05-26-static-v1"

const DEFAULT_USD_RATES: Record<SupportedCurrency, number> = {
  USD: 1,
  AUD: 1.5,
  GBP: 0.8,
  EUR: 0.9,
}

const RATE_ENV_KEYS: Partial<Record<SupportedCurrency, string>> = {
  AUD: "USD_TO_AUD_RATE",
  GBP: "USD_TO_GBP_RATE",
  EUR: "USD_TO_EUR_RATE",
}

export interface CurrencyConversion {
  baseAmountUsdCents: number
  chargedAmountMinor: number
  chargedCurrency: SupportedCurrency
  chargedCurrencyMinorUnit: number
  conversionRate: number
  conversionRateSource: "default" | "env"
  currencyConfigVersion: string
}

export interface PaymentCurrencyMetadata {
  base_amount_usd_cents: string
  charged_amount_minor: string
  charged_currency: SupportedCurrency
  charged_currency_minor_unit: string
  conversion_rate: string
  conversion_rate_source: "default" | "env"
  currency_config_version: string
}

export function isSupportedCurrency(
  value: string | null | undefined,
): value is SupportedCurrency {
  return SUPPORTED_CURRENCIES.includes(
    (value || "").toUpperCase() as SupportedCurrency,
  )
}

export function coerceSupportedCurrency(
  value: string | null | undefined,
): SupportedCurrency {
  const upper = (value || "").toUpperCase()
  return isSupportedCurrency(upper) ? upper : DEFAULT_SUPPORTED_CURRENCY
}

export function getCurrencyMinorUnit(
  currency: SupportedCurrency | string,
): number {
  const supported = coerceSupportedCurrency(currency)
  switch (supported) {
    case "USD":
    case "AUD":
    case "GBP":
    case "EUR":
      return 2
  }
}

function readRateOverride(currency: SupportedCurrency): number | null {
  const key = RATE_ENV_KEYS[currency]
  if (!key) return null
  const raw = process.env[key]
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function getUsdConversionRate(currency: SupportedCurrency): {
  rate: number
  source: "default" | "env"
} {
  const override = readRateOverride(currency)
  if (override !== null) return { rate: override, source: "env" }
  return { rate: DEFAULT_USD_RATES[currency], source: "default" }
}

export function convertUsdCentsToCurrency(
  baseAmountUsdCents: number,
  currencyInput: string | null | undefined,
): CurrencyConversion {
  const chargedCurrency = coerceSupportedCurrency(currencyInput)
  const chargedCurrencyMinorUnit = getCurrencyMinorUnit(chargedCurrency)
  const { rate, source } = getUsdConversionRate(chargedCurrency)
  const baseUnits = Math.max(0, Math.round(baseAmountUsdCents)) / 100
  const chargedAmountMinor = Math.round(
    baseUnits * rate * 10 ** chargedCurrencyMinorUnit,
  )
  return {
    baseAmountUsdCents: Math.max(0, Math.round(baseAmountUsdCents)),
    chargedAmountMinor,
    chargedCurrency,
    chargedCurrencyMinorUnit,
    conversionRate: rate,
    conversionRateSource: source,
    currencyConfigVersion: CURRENCY_CONFIG_VERSION,
  }
}

export function convertCurrencyMinorToUsdCents(
  amountMinor: number,
  currencyInput: string | null | undefined,
): number {
  const currency = coerceSupportedCurrency(currencyInput)
  const minorUnit = getCurrencyMinorUnit(currency)
  const { rate } = getUsdConversionRate(currency)
  const chargedUnits = Math.max(0, amountMinor) / 10 ** minorUnit
  return Math.round((chargedUnits / rate) * 100)
}

export function buildPaymentCurrencyMetadata(
  conversion: CurrencyConversion,
): PaymentCurrencyMetadata {
  return {
    base_amount_usd_cents: conversion.baseAmountUsdCents.toString(),
    charged_amount_minor: conversion.chargedAmountMinor.toString(),
    charged_currency: conversion.chargedCurrency,
    charged_currency_minor_unit:
      conversion.chargedCurrencyMinorUnit.toString(),
    conversion_rate: conversion.conversionRate.toString(),
    conversion_rate_source: conversion.conversionRateSource,
    currency_config_version: conversion.currencyConfigVersion,
  }
}

export function parsePaymentCurrencyMetadata(
  metadata: Record<string, string | null | undefined> | null | undefined,
): CurrencyConversion | null {
  if (!metadata) return null
  const currency = coerceSupportedCurrency(metadata.charged_currency)
  const baseAmountUsdCents = Number(metadata.base_amount_usd_cents)
  const chargedAmountMinor = Number(metadata.charged_amount_minor)
  const chargedCurrencyMinorUnit = Number(metadata.charged_currency_minor_unit)
  const conversionRate = Number(metadata.conversion_rate)
  const conversionRateSource =
    metadata.conversion_rate_source === "env" ? "env" : "default"
  if (
    !Number.isFinite(baseAmountUsdCents) ||
    !Number.isFinite(chargedAmountMinor) ||
    !Number.isFinite(chargedCurrencyMinorUnit) ||
    !Number.isFinite(conversionRate)
  ) {
    return null
  }
  return {
    baseAmountUsdCents: Math.round(baseAmountUsdCents),
    chargedAmountMinor: Math.round(chargedAmountMinor),
    chargedCurrency: currency,
    chargedCurrencyMinorUnit,
    conversionRate,
    conversionRateSource,
    currencyConfigVersion:
      metadata.currency_config_version || CURRENCY_CONFIG_VERSION,
  }
}

export function verifyCurrencyConversion(
  conversion: CurrencyConversion,
): boolean {
  const recomputed = convertUsdCentsToCurrency(
    conversion.baseAmountUsdCents,
    conversion.chargedCurrency,
  )
  return (
    recomputed.chargedAmountMinor === conversion.chargedAmountMinor &&
    recomputed.chargedCurrency === conversion.chargedCurrency &&
    recomputed.chargedCurrencyMinorUnit ===
      conversion.chargedCurrencyMinorUnit
  )
}

export function formatMoneyFromMinorUnits(
  amountMinor: number | null | undefined,
  currencyInput: string | null | undefined,
): string {
  const currency = coerceSupportedCurrency(currencyInput)
  const minorUnit = getCurrencyMinorUnit(currency)
  const amount = (amountMinor || 0) / 10 ** minorUnit
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: minorUnit,
    maximumFractionDigits: minorUnit,
  }).format(amount)
}

export function formatConversionForDisplay(
  conversion: CurrencyConversion,
): string {
  return formatMoneyFromMinorUnits(
    conversion.chargedAmountMinor,
    conversion.chargedCurrency,
  )
}

const EUROZONE_COUNTRIES = new Set([
  "AT",
  "BE",
  "CY",
  "DE",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PT",
  "SI",
  "SK",
])

export function getDefaultCurrencyForCountry(
  countryCodeInput: string | null | undefined,
): SupportedCurrency {
  const countryCode = (countryCodeInput || "").trim().toUpperCase()
  if (countryCode === "AU" || countryCode === "NZ") return "AUD"
  if (countryCode === "GB" || countryCode === "UK") return "GBP"
  if (EUROZONE_COUNTRIES.has(countryCode)) return "EUR"
  return "USD"
}

export function getDefaultCurrencyForLocale(
  localeInput: string | null | undefined,
): SupportedCurrency {
  const locale = localeInput || ""
  const region = locale.match(/[-_]([A-Za-z]{2})\b/)?.[1]
  return getDefaultCurrencyForCountry(region)
}
