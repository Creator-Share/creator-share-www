/** Round nonnegative minor units using the decimal rate sent to PostgreSQL.
 * Binary multiplication can put an exact half-cent just below the midpoint.
 * Invalid or unsafe results are NaN so existing financial guards fail closed.
 */
export function roundMinorUnitsAtRate(amountMinor: number, rate: number): number {
  if (
    !Number.isSafeInteger(amountMinor) ||
    amountMinor < 0 ||
    !Number.isFinite(rate) ||
    rate <= 0
  ) {
    return Number.NaN
  }

  const [coefficient, exponent = "0"] = rate.toString().split("e")
  const [whole, fraction = ""] = coefficient.split(".")
  const scale = fraction.length - Number(exponent)
  let numerator = BigInt(amountMinor) * BigInt(whole + fraction)
  const denominator = scale > 0 ? 10n ** BigInt(scale) : 1n
  if (scale < 0) numerator *= 10n ** BigInt(-scale)
  const rounded = (2n * numerator + denominator) / (2n * denominator)
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(rounded)
    : Number.NaN
}
