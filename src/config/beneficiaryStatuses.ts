/**
 * Single source of truth for beneficiary status values, groupings, and display config.
 *
 * Import from here instead of hardcoding status strings. Adding a new status
 * requires changing this file only.
 */

export const ALL_STATUSES = [
  "New",
  "Partially Funded",
  "Budget Fulfilled",
  "Draft",
  "Archived",
  "Sponsorship Cancelled",
] as const

export type Status = (typeof ALL_STATUSES)[number]

// ---------------------------------------------------------------------------
// Semantic groupings used throughout the app
// ---------------------------------------------------------------------------

/** Statuses shown in the public-facing "waiting" list. */
export const WAITING_STATUSES: Status[] = ["New", "Partially Funded"]

/**
 * Statuses treated as "active" for the default public filter — includes
 * Sponsorship Cancelled so reinstated beneficiaries remain discoverable.
 */
export const ACTIVE_STATUSES: Status[] = [
  "New",
  "Partially Funded",
  "Sponsorship Cancelled",
]

/** Statuses where age-range filtering is skipped (records may span any age). */
export const INACTIVE_STATUSES: Status[] = ["Draft", "Archived", "Budget Fulfilled"]

/**
 * Statuses that can be set by admin bulk-action.
 * "Sponsorship Cancelled" is system-set (via webhook on subscription cancel)
 * and must not be assignable through the bulk-update UI.
 */
export const BULK_ASSIGNABLE_STATUSES: Status[] = ALL_STATUSES.filter(
  (s) => s !== "Sponsorship Cancelled",
) as Status[]

// ---------------------------------------------------------------------------
// Display config
// ---------------------------------------------------------------------------

export interface StatusDisplayConfig {
  color: string
  label: string
}

export const STATUS_DISPLAY_CONFIG: Record<Status, StatusDisplayConfig> = {
  New: { color: "blue", label: "New" },
  "Partially Funded": { color: "orange", label: "Partially Funded" },
  "Budget Fulfilled": { color: "green", label: "Budget Fulfilled" },
  Draft: { color: "purple", label: "Draft" },
  Archived: { color: "red", label: "Archived" },
  "Sponsorship Cancelled": { color: "yellow", label: "Sponsorship Cancelled" },
}
