import Link from "next/link"
import { redirect } from "next/navigation"

import { advocatePortalDisplayHostname } from "@/components/advocates/admin/PortalShell"
import { loadAuthenticatedAdvocatePortalSession } from "@/lib/advocates/admin/access"

function publicationLabel(value: string): string {
  return value
    .split("_")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ")
}

export default async function AdvocatePortalIndexPage() {
  const session = await loadAuthenticatedAdvocatePortalSession()
  if (session === null) redirect("/login")

  if (session.portals.length === 1) {
    redirect(`/portal/${session.portals[0].slug}`)
  }

  return (
    <main className="min-h-[calc(100vh-88px)] bg-gray-50 px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-4xl">
        <header>
          <h1 className="text-3xl font-bold text-gray-950">Advocate portals</h1>
          <p className="mt-2 max-w-2xl text-gray-600">
            Choose a Creator Share advocate experience to manage.
          </p>
        </header>

        {session.portals.length === 0 ? (
          <section
            aria-labelledby="no-portals-heading"
            className="mt-8 rounded-xl border border-gray-200 bg-white p-8"
          >
            <h2 id="no-portals-heading" className="text-xl font-semibold">
              No advocate portals are available
            </h2>
            <p className="mt-2 text-gray-600">
              Your account does not currently have an active portal membership.
            </p>
          </section>
        ) : (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {session.portals.map((portal) => (
              <li key={portal.slug}>
                <Link
                  href={`/portal/${portal.slug}`}
                  className="block min-h-36 rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition hover:border-blue-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                >
                  <h2 className="text-xl font-semibold text-gray-950">
                    {portal.displayName}
                  </h2>
                  <p className="mt-2 text-sm text-gray-600">
                    Publication: {publicationLabel(portal.publicationStatus)}
                  </p>
                  <p className="mt-1 truncate text-sm text-gray-500">
                    {advocatePortalDisplayHostname(portal.canonicalHostname)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
