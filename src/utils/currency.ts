export const dollarsToCents = (dollars: number): string => {
  return Math.round(Math.max(0, dollars) * 100).toString()
}

export const centsToDollars = (cents: number): string => {
  return (cents / 100).toFixed(2)
}

export const formatUsdCents = (cents: number | null | undefined): string => {
  return formatMoney(cents || 0, "USD")
}

export const SUPPORTED_CURRENCIES = ["USD", "AUD", "GBP", "EUR"] as const

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

export const DEFAULT_SUPPORTED_CURRENCY: SupportedCurrency = "USD"

import { RATES } from "@/config/rates"

/**
 * Rate lookup. Returns the configured default rate from config/rates.ts.
 * Rate is a pure ratio: foreign minor units per 1 USD cent.
 * Conversion: chargedAmountMinor = usdCents × rate
 *
 * Both sides are cent-equivalents (integers). No major-unit conversion.
 *
 * TODO: replace with database-backed auto-updating FX rates table.
 */

/** Full result of a currency conversion.
 *
 * All monetary values are cent-equivalents (integers). The conversion
 * formula is always: chargedAmountMinor = baseAmountUsdCents × rate. */
export interface CurrencyConversion {
  baseAmountUsdCents: number
  chargedAmountMinor: number
  chargedCurrency: SupportedCurrency
  conversionRate: number
}

export interface PaymentCurrencyMetadata {
  base_amount_usd_cents: string
  charged_amount_minor: string
  charged_currency: SupportedCurrency
  conversion_rate: string
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

export function getUsdConversionRate(currency: SupportedCurrency): number {
  return RATES[currency] ?? 1
}

export function convertUsdCentsToCurrency(
  baseAmountUsdCents: number,
  currencyInput: string | null | undefined,
): CurrencyConversion {
  const chargedCurrency = coerceSupportedCurrency(currencyInput)
  const rate = getUsdConversionRate(chargedCurrency)
  const baseAmount = Math.max(0, Math.round(baseAmountUsdCents))
  // Rate is a pure ratio: foreign minor units per 1 USD cent.
  // Examples: 0.74 GBP pence per USD cent, 1.40 AUD cents per USD cent.
  // No major-unit conversion needed — all math is in cent-equivalents.
  const chargedAmountMinor = Math.round(baseAmount * rate)
  return {
    baseAmountUsdCents: Math.max(0, Math.round(baseAmountUsdCents)),
    chargedAmountMinor,
    chargedCurrency,
    conversionRate: rate,
  }
}

export function convertCurrencyMinorToUsdCents(
  amountMinor: number,
  currencyInput: string | null | undefined,
): number {
  const currency = coerceSupportedCurrency(currencyInput)
  const rate = getUsdConversionRate(currency)
  // Inverse of the forward conversion: usdCents = foreignMinor / rate
  // Rate is foreign minor units per 1 USD cent (pure ratio).
  return Math.round(Math.max(0, amountMinor) / rate)
}

export function buildPaymentCurrencyMetadata(
  conversion: CurrencyConversion,
): PaymentCurrencyMetadata {
  return {
    base_amount_usd_cents: conversion.baseAmountUsdCents.toString(),
    charged_amount_minor: conversion.chargedAmountMinor.toString(),
    charged_currency: conversion.chargedCurrency,
    conversion_rate: conversion.conversionRate.toString(),
  }
}

export function parsePaymentCurrencyMetadata(
  metadata: Record<string, string | null | undefined> | null | undefined,
): CurrencyConversion | null {
  if (!metadata) return null
  const currency = coerceSupportedCurrency(metadata.charged_currency)
  const baseAmountUsdCents = Number(metadata.base_amount_usd_cents)
  const chargedAmountMinor = Number(metadata.charged_amount_minor)
  const conversionRate = Number(metadata.conversion_rate)
  if (
    !Number.isFinite(baseAmountUsdCents) ||
    !Number.isFinite(chargedAmountMinor) ||
    !Number.isFinite(conversionRate)
  ) {
    return null
  }
  return {
    baseAmountUsdCents: Math.round(baseAmountUsdCents),
    chargedAmountMinor: Math.round(chargedAmountMinor),
    chargedCurrency: currency,
    conversionRate,
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
    recomputed.chargedCurrency === conversion.chargedCurrency
  )
}

export function formatMoney(
  amountCents: number | null | undefined,
  currencyInput: string | null | undefined,
): string {
  const currency = coerceSupportedCurrency(currencyInput)
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((amountCents || 0) / 100)
}

export function formatConversionForDisplay(
  conversion: CurrencyConversion,
): string {
  return formatMoney(
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
