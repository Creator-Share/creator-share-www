import {
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
    conversion.conversionRate,
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
    conversionRateRaw,
  ] = raw.split("|")

  const baseAmountUsdCents = Number(baseAmountUsdCentsRaw)
  const chargedAmountMinor = Number(chargedAmountMinorRaw)
  const conversionRate = Number(conversionRateRaw)

  if (
    !Number.isFinite(baseAmountUsdCents) ||
    !Number.isFinite(chargedAmountMinor) ||
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
      conversionRate,
    },
  }
}
