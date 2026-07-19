import { notFound, redirect } from "next/navigation"

import {
  findAdvocatePortalAccessBySlug,
  loadAuthenticatedAdvocatePortalSession,
} from "@/lib/advocates/admin/access"

function readableStatus(value: string): string {
  return value
    .split("_")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ")
}

export default async function AdvocatePortalOverviewPage({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  const session = await loadAuthenticatedAdvocatePortalSession()
  if (session === null) redirect("/login")

  const { slug } = await params
  const portal = findAdvocatePortalAccessBySlug(session.portals, slug)
  if (portal === null) notFound()

  const details = [
    ["Relationship", readableStatus(portal.relationshipStatus)],
    ["Publication", readableStatus(portal.publicationStatus)],
    ["Domain", portal.canonicalHostname ?? "Not yet assigned"],
    [
      "Domain status",
      portal.domainStatus
        ? readableStatus(portal.domainStatus)
        : "Not yet assigned",
    ],
    ["Child display", readableStatus(portal.beneficiaryMode)],
  ] as const

  return (
    <section
      aria-labelledby="portal-overview-heading"
      className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <h2 id="portal-overview-heading" className="text-2xl font-bold">
        Portal overview
      </h2>
      <p className="mt-2 text-gray-600">
        Current identity, publication, and catalog configuration.
      </p>

      <dl className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {details.map(([label, value]) => (
          <div key={label} className="border-t border-gray-100 pt-4">
            <dt className="text-sm font-medium text-gray-500">{label}</dt>
            <dd className="mt-1 break-words text-base font-semibold text-gray-900">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
