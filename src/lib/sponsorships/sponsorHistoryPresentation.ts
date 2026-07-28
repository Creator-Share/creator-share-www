import type { SponsorOneTimeHistoryItem } from "@/lib/sponsorships/sponsorAccountHistory"
import { formatMoney, formatUsdCents } from "@/utils/currency"

export interface SponsorHistoryMoneyPresentation {
  primaryAmount: string
  normalizedNetAmount: string | null
  originalAmount: string | null
}

/**
 * Presents the net amount as the primary financial truth. The original charge
 * is supplementary evidence only when a refund, reversal, or withholding
 * changed the sponsor's net position.
 */
export function presentSponsorHistoryMoney(
  item: SponsorOneTimeHistoryItem,
): SponsorHistoryMoneyPresentation {
  const netCharged = formatMoney(
    item.netChargedAmountMinor,
    item.chargedCurrency,
  )
  const hasAdjustment =
    item.netChargedAmountMinor !== item.chargedAmountMinor ||
    item.netBaseAmountUsdCents !== item.baseAmountUsdCents

  return {
    primaryAmount: hasAdjustment ? `Net ${netCharged}` : netCharged,
    normalizedNetAmount:
      item.chargedCurrency === "USD"
        ? null
        : `${formatUsdCents(item.netBaseAmountUsdCents)} normalized net`,
    originalAmount: hasAdjustment
      ? `Originally ${formatMoney(
          item.chargedAmountMinor,
          item.chargedCurrency,
        )}`
      : null,
  }
}
