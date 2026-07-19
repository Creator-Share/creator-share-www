import Link from "next/link"
import type { ReactNode } from "react"

import type {
  AdvocatePortalAccess,
  AdvocatePortalPermission,
} from "@/lib/advocates/admin/access"
import { PortalNavigation } from "@/components/advocates/admin/PortalNavigation"

export type AdvocatePortalSection =
  | "overview"
  | "branding"
  | "catalog"
  | "public-metrics"
  | "analytics"
  | "team"
  | "audit"
  | "domain"

export interface AdvocatePortalNavigationItem {
  section: AdvocatePortalSection
  label: string
  href: string | null
  current: boolean
  availability: "available" | "coming-soon"
}

const FUTURE_SECTIONS = Object.freeze([
  {
    section: "catalog",
    label: "Catalog",
    permission: "portal.beneficiaries.manage",
  },
  {
    section: "public-metrics",
    label: "Public metrics",
    permission: "portal.public_metrics.update",
  },
  {
    section: "analytics",
    label: "Analytics",
    permission: "portal.analytics.view",
  },
  {
    section: "team",
    label: "Team",
    permission: "portal.members.view",
  },
  {
    section: "audit",
    label: "Audit history",
    permission: "portal.audit.view",
  },
  {
    section: "domain",
    label: "Domain",
    permission: "portal.domains.view",
  },
] as const satisfies readonly {
  section: Exclude<AdvocatePortalSection, "overview">
  label: string
  permission: AdvocatePortalPermission
}[])

export function buildAdvocatePortalNavigation(
  portal: Pick<AdvocatePortalAccess, "slug" | "permissions">,
  currentSection: AdvocatePortalSection = "overview",
): readonly AdvocatePortalNavigationItem[] {
  const permissions = new Set<AdvocatePortalPermission>(portal.permissions)
  const items: AdvocatePortalNavigationItem[] = [
    {
      section: "overview",
      label: "Overview",
      href: `/portal/${portal.slug}`,
      current: currentSection === "overview",
      availability: "available",
    },
    {
      section: "branding",
      label: "Branding",
      href: `/portal/${portal.slug}/branding`,
      current: currentSection === "branding",
      availability: "available",
    },
  ]

  for (const section of FUTURE_SECTIONS) {
    if (!permissions.has(section.permission)) continue
    const href =
      section.section === "catalog"
        ? `/portal/${portal.slug}/catalog`
        : section.section === "public-metrics"
          ? `/portal/${portal.slug}/public-metrics`
          : section.section === "analytics"
            ? `/portal/${portal.slug}/analytics`
            : section.section === "team"
              ? `/portal/${portal.slug}/team`
              : section.section === "audit"
                ? `/portal/${portal.slug}/audit`
                : null
    items.push({
      section: section.section,
      label: section.label,
      href,
      current: currentSection === section.section,
      availability: href === null ? "coming-soon" : "available",
    })
  }
  return Object.freeze(items)
}

export function activeAdvocatePublicPortalHref(
  portal: Pick<
    AdvocatePortalAccess,
    | "canonicalHostname"
    | "domainStatus"
    | "publicationStatus"
    | "relationshipStatus"
  >,
): string | null {
  return portal.relationshipStatus === "active" &&
    portal.publicationStatus === "active" &&
    portal.domainStatus === "active" &&
    portal.canonicalHostname
    ? `https://${portal.canonicalHostname}`
    : null
}

function statusLabel(value: string): string {
  return value
    .split("_")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ")
}

export function PortalShell({
  portal,
  currentSection = "overview",
  children,
}: {
  portal: AdvocatePortalAccess
  currentSection?: AdvocatePortalSection
  children: ReactNode
}) {
  const navigation = buildAdvocatePortalNavigation(portal, currentSection)
  const publicPortalHref = activeAdvocatePublicPortalHref(portal)

  return (
    <div className="min-h-[calc(100vh-88px)] bg-gray-50 text-gray-950">
      <a
        href="#advocate-portal-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[1300] focus:rounded-md focus:bg-white focus:px-4 focus:py-3 focus:font-semibold focus:text-blue-800 focus:shadow-lg"
      >
        Skip to portal content
      </a>

      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <Link
              href="/portal"
              className="text-sm font-semibold text-blue-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              Advocate portals
            </Link>
            <h1 className="mt-2 truncate text-2xl font-bold sm:text-3xl">
              {portal.displayName}
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              Publication: {statusLabel(portal.publicationStatus)}
            </p>
          </div>

          {publicPortalHref ? (
            <a
              href={publicPortalHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-blue-700 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              View public portal
              <span className="sr-only"> in a new tab</span>
            </a>
          ) : null}
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1200px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:py-8">
        <PortalNavigation navigation={navigation} />

        <main id="advocate-portal-main" tabIndex={-1} className="min-w-0">
          {children}
        </main>
      </div>
    </div>
  )
}
