import { isValidBeneficiaryUsername } from "@/config/beneficiaryValidation"

const QUALIFYING_STATIC_BROWSE_PATHS = new Set([
  "/",
  "/child_laborers",
  "/special_needs",
  "/in_our_care",
  "/dogs",
  "/about",
  "/centers",
  "/contact",
  "/faq",
])

export type PublicAdvocateBrowseRoute = Readonly<{
  routeId: "browse-page" | "catalog-redirect" | "beneficiary-profile-page"
  qualifiesAsExposure: boolean
}>

const BROWSE_PAGE = Object.freeze({
  routeId: "browse-page",
  qualifiesAsExposure: true,
} satisfies PublicAdvocateBrowseRoute)

const CATALOG_REDIRECT = Object.freeze({
  routeId: "catalog-redirect",
  qualifiesAsExposure: false,
} satisfies PublicAdvocateBrowseRoute)

const BENEFICIARY_PROFILE_PAGE = Object.freeze({
  routeId: "beneficiary-profile-page",
  qualifiesAsExposure: true,
} satisfies PublicAdvocateBrowseRoute)

export function resolvePublicAdvocateBrowseRoute(
  pathname: string,
): PublicAdvocateBrowseRoute | null {
  if (QUALIFYING_STATIC_BROWSE_PATHS.has(pathname)) return BROWSE_PAGE
  if (pathname === "/sponsorships") return CATALOG_REDIRECT
  if (!pathname.startsWith("/sponsorships/")) return null

  const username = pathname.slice("/sponsorships/".length)
  return isValidBeneficiaryUsername(username) ? BENEFICIARY_PROFILE_PAGE : null
}

export function isQualifyingAdvocateExposurePagePath(
  pathname: string,
): boolean {
  return (
    resolvePublicAdvocateBrowseRoute(pathname)?.qualifiesAsExposure === true
  )
}
