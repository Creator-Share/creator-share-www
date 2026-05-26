import {
  CURRENCY_CONFIG_VERSION,
  type CurrencyConversion,
  type SupportedCurrency,
  coerceSupportedCurrency,
} from "@/utils/currency"

export interface PayPalPaymentContext {
  beneficiaryId: string | null
  conversion: CurrencyConversion | null
}

export function encodePayPalPaymentContext(
  beneficiaryId: string | null | undefined,
  conversion: CurrencyConversion,
): string {
  return [
    "cs",
    beneficiaryId || "",
    conversion.baseAmountUsdCents,
    conversion.chargedAmountMinor,
    conversion.chargedCurrency,
    conversion.chargedCurrencyMinorUnit,
    conversion.conversionRate,
    conversion.conversionRateSource,
    conversion.currencyConfigVersion,
  ].join("|")
}

export function parsePayPalPaymentContext(
  customId: string | null | undefined,
): PayPalPaymentContext {
  const raw = customId || ""
  if (!raw.startsWith("cs|")) {
    return {
      beneficiaryId: raw || null,
      conversion: null,
    }
  }

  const [
    ,
    beneficiaryId,
    baseAmountUsdCentsRaw,
    chargedAmountMinorRaw,
    chargedCurrencyRaw,
    chargedCurrencyMinorUnitRaw,
    conversionRateRaw,
    conversionRateSourceRaw,
    currencyConfigVersionRaw,
  ] = raw.split("|")

  const baseAmountUsdCents = Number(baseAmountUsdCentsRaw)
  const chargedAmountMinor = Number(chargedAmountMinorRaw)
  const chargedCurrencyMinorUnit = Number(chargedCurrencyMinorUnitRaw)
  const conversionRate = Number(conversionRateRaw)

  if (
    !Number.isFinite(baseAmountUsdCents) ||
    !Number.isFinite(chargedAmountMinor) ||
    !Number.isFinite(chargedCurrencyMinorUnit) ||
    !Number.isFinite(conversionRate)
  ) {
    return {
      beneficiaryId: beneficiaryId || null,
      conversion: null,
    }
  }

  return {
    beneficiaryId: beneficiaryId || null,
    conversion: {
      baseAmountUsdCents: Math.round(baseAmountUsdCents),
      chargedAmountMinor: Math.round(chargedAmountMinor),
      chargedCurrency: coerceSupportedCurrency(chargedCurrencyRaw) as SupportedCurrency,
      chargedCurrencyMinorUnit: Math.round(chargedCurrencyMinorUnit),
      conversionRate,
      conversionRateSource:
        conversionRateSourceRaw === "env" ? "env" : "default",
      currencyConfigVersion:
        currencyConfigVersionRaw || CURRENCY_CONFIG_VERSION,
    },
  }
}
