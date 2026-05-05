/**
 * Single source of truth for all beneficiary type configuration.
 *
 * Both the public-facing UI and the admin system derive their type lists,
 * route mappings, budget goals, age constraints, and display labels
 * from this file. Add a new type here and it propagates everywhere.
 *
 * Two sponsorship models:
 *
 *   Fixed (isOpenSponsorship = false):
 *     One sponsor, one payment, goal fulfilled. The budget goal IS the
 *     sponsorship amount. E.g. child laborers at $33.33.
 *
 *   Open (isOpenSponsorship = true):
 *     Multiple sponsors, user-chosen amount above MINIMUM_OPEN_SPONSORSHIP_CENTS.
 *     Budget goal is -1 (infinite). Never "fully sponsored."
 */

export type BeneficiaryTabType =
  | "CHILD"
  | "CHILD_LABORER"
  | "SPECIAL_NEEDS"
  | "FULLTIME_CARE"
  | "ANIMAL"

export interface BeneficiaryTypeConfig {
  label: string
  type: BeneficiaryTabType | null
  /**
   * When true, this type accepts unlimited sponsors who each choose their
   * own amount (above MINIMUM_OPEN_SPONSORSHIP_CENTS). Budget goal is -1.
   * When false, one sponsor pays the full defaultBudgetGoalCents amount.
   */
  isOpenSponsorship: boolean
  /**
   * Default budget goal in cents, written to the beneficiary record on create.
   * -1 for open sponsorship types (infinite — never fully funded).
   * For fixed types this is also the sponsorship amount (one sponsor = fully funded).
   */
  defaultBudgetGoalCents: number
  /**
   * Legacy DB alias — hidden from all nav rendering. Kept so
   * getDefaultBudgetGoal("CHILD") resolves for older records.
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

/** Minimum sponsorship amount (cents) for open sponsorship types. */
export const MINIMUM_OPEN_SPONSORSHIP_CENTS = 500
/** Maximum sponsorship amount (cents) for open sponsorship types. */
export const MAXIMUM_OPEN_SPONSORSHIP_CENTS = 100000

export const ALL_BENEFICIARY_TABS: BeneficiaryTypeConfig[] = [
  {
    label: "All Opportunities",
    type: null,
    isOpenSponsorship: false,
    defaultBudgetGoalCents: 0,
    isPubliclyVisible: true,
    singularName: "being",
    pluralName: "beings",
    maxAgeYears: null,
    route: "/",
  },
  {
    label: "Child Labourers",
    type: "CHILD_LABORER",
    isOpenSponsorship: false,
    defaultBudgetGoalCents: 3333,
    isPubliclyVisible: true,
    singularName: "child",
    pluralName: "children",
    maxAgeYears: 14,
    route: "/child_laborers",
  },
  {
    label: "Special Needs",
    type: "SPECIAL_NEEDS",
    isOpenSponsorship: true,
    defaultBudgetGoalCents: -1,
    isPubliclyVisible: true,
    singularName: "child",
    pluralName: "children",
    maxAgeYears: 14,
    route: "/special_needs",
  },
  {
    label: "Fulltime Care",
    type: "FULLTIME_CARE",
    isOpenSponsorship: true,
    defaultBudgetGoalCents: -1,
    isPubliclyVisible: true,
    singularName: "child",
    pluralName: "children",
    maxAgeYears: 14,
    route: "/fulltime_care",
  },
  {
    label: "Rescue Dogs",
    type: "ANIMAL",
    isOpenSponsorship: false,
    defaultBudgetGoalCents: 2500,
    isPubliclyVisible: false, // coming soon
    singularName: "dog",
    pluralName: "dogs",
    maxAgeYears: 20,
    route: "/dogs",
  },
]

// ---------------------------------------------------------------------------
// Route maps
// ---------------------------------------------------------------------------

/** Maps a BeneficiaryTabType to its sharable public URL path. */
export const TYPE_TO_ROUTE: Record<BeneficiaryTabType, string> = {
  CHILD_LABORER: "/child_laborers",
  SPECIAL_NEEDS: "/special_needs",
  FULLTIME_CARE: "/fulltime_care",
  ANIMAL: "/dogs",
}

/**
 * Maps a sharable public URL path back to its BeneficiaryTabType.
 * "/" resolves to null (= "All").
 */
export const ROUTE_TO_TYPE: Record<string, BeneficiaryTabType | null> = {
  "/": null,
  "/child_laborers": "CHILD_LABORER",
  "/special_needs": "SPECIAL_NEEDS",
  "/fulltime_care": "FULLTIME_CARE",
  "/dogs": "ANIMAL",
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up the config entry for a given type string. */
function findConfig(
  type: BeneficiaryTabType | string | null | undefined,
): BeneficiaryTypeConfig | undefined {
  return ALL_BENEFICIARY_TABS.find((t) => t.type === type)
}

/**
 * Returns the default budget goal in cents for a given type.
 * Accepts the raw DB type string so legacy "CHILD" records resolve correctly.
 * Returns 0 when the type is unknown.
 */
export function getDefaultBudgetGoal(
  type: BeneficiaryTabType | string | null | undefined,
): number {
  return findConfig(type)?.defaultBudgetGoalCents ?? 0
}

/**
 * Returns true if the given type uses open sponsorships (user-chosen amount,
 * unlimited sponsors, no fixed goal).
 */
export function isOpenSponsorshipType(
  type: BeneficiaryTabType | string | null | undefined,
): boolean {
  return findConfig(type)?.isOpenSponsorship ?? false
}

/**
 * Returns the comma-separated beneficiary_type string expected by the API.
 * CHILD_LABORER expands to "CHILD,CHILD_LABORER" to include legacy records.
 */
export function getApiTypes(
  type: BeneficiaryTabType | null,
): string | undefined {
  if (!type) return undefined
  if (type === "CHILD_LABORER") return "CHILD,CHILD_LABORER"
  return type
}

/**
 * Returns the maximum age (years) for the age-range filter for a given type.
 * Defaults to 14 when no type-specific value is defined.
 */
export function getMaxAgeYears(type: BeneficiaryTabType | null): number {
  return findConfig(type)?.maxAgeYears ?? 14
}
