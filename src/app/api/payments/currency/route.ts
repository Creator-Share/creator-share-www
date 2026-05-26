import { NextResponse } from "next/server"
import {
  CURRENCY_CONFIG_VERSION,
  DEFAULT_SUPPORTED_CURRENCY,
  SUPPORTED_CURRENCIES,
  getDefaultCurrencyForCountry,
  getUsdConversionRate,
} from "@/utils/currency"

export async function GET(req: Request) {
  const country =
    req.headers.get("x-vercel-ip-country") ||
    req.headers.get("cf-ipcountry") ||
    req.headers.get("x-country-code") ||
    ""
  const currency = country
    ? getDefaultCurrencyForCountry(country)
    : DEFAULT_SUPPORTED_CURRENCY

  return NextResponse.json({
    country: country || null,
    currency,
    currencies: SUPPORTED_CURRENCIES,
    rates: Object.fromEntries(
      SUPPORTED_CURRENCIES.map((item) => [item, getUsdConversionRate(item)]),
    ),
    configVersion: CURRENCY_CONFIG_VERSION,
  })
}
