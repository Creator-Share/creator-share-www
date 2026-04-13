/**
 * Single source of truth for all beneficiary type configuration.
 *
 * Both the public-facing UI and the admin system derive their type lists,
 * route mappings, sponsorship amounts, age constraints, and display labels
 * from this file. Add a new type here and it propagates everywhere.
 */

export type BeneficiaryTabType = "CHILD" | "CHILD_LABORER" | "SPECIAL_NEEDS" | "ANIMAL"

export interface BeneficiaryTypeConfig {
  label: string
  type: BeneficiaryTabType | null
  /**
   * Default sponsorship amount in cents when this type has no fixed budget_goal.
   * null = free-form (user chooses any amount).
   */
  defaultSponsorshipAmountCents: number | null
  /**
   * Legacy DB alias — hidden from all nav rendering. Kept so
   * getDefaultSponsorshipAmount("CHILD") resolves for older records.
   */
  isLegacyAlias?: boolean
  /**
   * When false, hidden from all public-facing UI (nav tabs, filter dropdowns,
   * hero links). Still visible to admins so they can manage existing records.
   */
  isPubliclyVisible: boolean
  /** Singular noun for one beneficiary of this type, e.g. "child", "dog". */
  singularName: string
  /** Plural noun for multiple beneficiaries of this type, e.g. "children", "dogs". */
  pluralName: string
  /**
   * Maximum age (years) used by the age-range filter for this type.
   * null for the "All" entry (no single sensible default).
   */
  maxAgeYears: number | null
  /** Public URL path for this type's landing page. null for the "All" entry. */
  route: string | null
}

/** Read a per-type sponsorship amount from a NEXT_PUBLIC_ env variable. */
function envAmount(envKey: string, fallbackCents: number): number {
  const raw = process.env[envKey]
  if (!raw) return fallbackCents
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackCents
}

export const ALL_BENEFICIARY_TABS: BeneficiaryTypeConfig[] = [
  {
    label: "All Opportunities",
    type: null,
    defaultSponsorshipAmountCents: null,
    isPubliclyVisible: true,
    singularName: "being",
    pluralName: "beings",
    maxAgeYears: null,
    route: "/",
  },
  {
    // Legacy DB alias for older "CHILD" records. Treated identically to
    // CHILD_LABORER in queries. Hidden from nav in all contexts.
    label: "Child Labourers",
    type: "CHILD",
    isLegacyAlias: true,
    isPubliclyVisible: true,
    singularName: "child",
    pluralName: "children",
    maxAgeYears: 14,
    route: "/street",
    defaultSponsorshipAmountCents: envAmount(
      "NEXT_PUBLIC_SPONSORSHIP_AMOUNT_CHILD_LABORER",
      3333,
    ),
  },
  {
    label: "Child Labourers",
    type: "CHILD_LABORER",
    isPubliclyVisible: true,
    singularName: "child",
    pluralName: "children",
    maxAgeYears: 14,
    route: "/street",
    defaultSponsorshipAmountCents: envAmount(
      "NEXT_PUBLIC_SPONSORSHIP_AMOUNT_CHILD_LABORER",
      3333,
    ),
  },
  {
    label: "Special Needs",
    type: "SPECIAL_NEEDS",
    isPubliclyVisible: true,
    singularName: "child",
    pluralName: "children",
    maxAgeYears: 14,
    route: "/care",
    defaultSponsorshipAmountCents: envAmount(
      "NEXT_PUBLIC_SPONSORSHIP_AMOUNT_SPECIAL_NEEDS",
      5000,
    ),
  },
  {
    label: "Rescue Dogs",
    type: "ANIMAL",
    isPubliclyVisible: false, // coming soon — rendering code is preserved
    singularName: "dog",
    pluralName: "dogs",
    maxAgeYears: 20,
    route: "/dogs",
    defaultSponsorshipAmountCents: envAmount(
      "NEXT_PUBLIC_SPONSORSHIP_AMOUNT_ANIMAL",
      2500,
    ),
  },
]

// ---------------------------------------------------------------------------
// Route maps
// ---------------------------------------------------------------------------

/** Maps a BeneficiaryTabType to its sharable public URL path. */
export const TYPE_TO_ROUTE: Record<BeneficiaryTabType, string> = {
  CHILD: "/street", // legacy alias — same route as CHILD_LABORER
  CHILD_LABORER: "/street",
  SPECIAL_NEEDS: "/care",
  ANIMAL: "/dogs",
}

/**
 * Maps a sharable public URL path back to its BeneficiaryTabType.
 * "/" resolves to null (= "All").
 */
export const ROUTE_TO_TYPE: Record<string, BeneficiaryTabType | null> = {
  "/": null,
  "/street": "CHILD_LABORER",
  "/care": "SPECIAL_NEEDS",
  "/dogs": "ANIMAL",
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the default sponsorship amount in cents for a given type.
 * Accepts the raw DB type string so legacy "CHILD" records resolve correctly.
 */
export function getDefaultSponsorshipAmount(
  type: BeneficiaryTabType | string | null | undefined,
): number | null {
  const tab = ALL_BENEFICIARY_TABS.find((t) => t.type === type)
  return tab ? tab.defaultSponsorshipAmountCents : null
}

/**
 * Returns the comma-separated beneficiary_type string expected by the API.
 * CHILD_LABORER expands to "CHILD,CHILD_LABORER" to include legacy records.
 */
export function getApiTypes(type: BeneficiaryTabType | null): string | undefined {
  if (!type) return undefined
  if (type === "CHILD_LABORER") return "CHILD,CHILD_LABORER"
  return type
}

/**
 * Returns the maximum age (years) for the age-range filter for a given type.
 * Defaults to 14 when no type-specific value is defined.
 */
export function getMaxAgeYears(type: BeneficiaryTabType | null): number {
  const config = ALL_BENEFICIARY_TABS.find((t) => t.type === type)
  return config?.maxAgeYears ?? 14
}
