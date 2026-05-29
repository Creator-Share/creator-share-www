/**
 * Currency conversion rates.
 *
 * Rates are a pure ratio: foreign currency minor units per 1 USD cent.
 * There is no major-unit / minor-unit distinction — all math is done in
 * cent-equivalents. 1 USD cent = 1 unit, 1 GB pence = 1 unit.
 *
 *   chargedAmountMinor = usdCents × rate             (forward)
 *   usdCents = chargedAmountMinor / rate             (reverse)
 *
 * Accounting is done in USD cents. Foreign currencies are recorded at
 * charge time but immediately converted and accounted in USD cents.
 *
 * --- STANDARD ---
 * A) ALL accounting is in cents or cent-equivalent (integer minor units).
 * B) Conversion flows foreign → USD only as a construct.
 * C) Rates are always foreign_units / usd_cent. Never the inverse.
 * D) Foreign amounts are recorded verbatim but accounted in USD cents.
 *
 * Rate source: fx-rate-api
 * Last updated: 2026-05-28
 *
 * TODO: replace with database-backed auto-updating FX rates table.
 */

export const RATES: Record<string, number> = {
  USD: 1,
  AUD: 1.40,   // 1 USD cent = 1.40 AUD cents
  GBP: 0.74,   // 1 USD cent = 0.74 GB pence
  EUR: 0.86,   // 1 USD cent = 0.86 EUR cents
}
