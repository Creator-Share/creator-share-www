import Link from "next/link"
import { notFound } from "next/navigation"

import {
  createCreatorShareAdvocateControlRepository,
  parseCreatorShareAdvocateControlCursor,
  parseCreatorShareAdvocatePublicationFilter,
  parseCreatorShareAdvocateRelationshipFilter,
} from "@/lib/advocates/creatorShareAdmin/lifecycle"
import { createClient } from "@/utils/supabase/server"

export const dynamic = "force-dynamic"

type SearchValue = string | string[] | undefined

function singleValue(value: SearchValue): string | undefined {
  return typeof value === "string" ? value : undefined
}

function statusLabel(value: string): string {
  return value
    .split("_")
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ")
}

function timestampLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))
}

export default async function CreatorShareAdvocateControlsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, SearchValue>>
}>) {
  const query = await searchParams
  const relationshipValue = singleValue(query.relationship)
  const publicationValue = singleValue(query.publication)
  const cursorValue = singleValue(query.cursor)
  if (
    Object.keys(query).some(
      (key) => !["cursor", "publication", "relationship"].includes(key),
    ) ||
    (query.relationship !== undefined && relationshipValue === undefined) ||
    (query.publication !== undefined && publicationValue === undefined) ||
    (query.cursor !== undefined && cursorValue === undefined)
  ) {
    notFound()
  }

  const relationshipStatus =
    parseCreatorShareAdvocateRelationshipFilter(relationshipValue)
  const publicationStatus =
    parseCreatorShareAdvocatePublicationFilter(publicationValue)
  if (
    (relationshipValue && relationshipStatus === null) ||
    (publicationValue && publicationStatus === null) ||
    (cursorValue !== undefined &&
      parseCreatorShareAdvocateControlCursor(cursorValue) === null)
  ) {
    notFound()
  }

  const client = await createClient()
  const page = await createCreatorShareAdvocateControlRepository(client).list({
    relationshipStatus,
    publicationStatus,
    cursor: cursorValue ?? null,
  })

  const nextQuery = new URLSearchParams()
  if (relationshipStatus) nextQuery.set("relationship", relationshipStatus)
  if (publicationStatus) nextQuery.set("publication", publicationStatus)
  if (page.nextCursor) nextQuery.set("cursor", page.nextCursor)

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">
            Creator Share administration
          </p>
          <h1 className="mt-1 text-3xl font-bold text-gray-950">
            Advocate portals
          </h1>
          <p className="mt-2 max-w-3xl text-gray-600">
            Review tenant lifecycle, aggregate infrastructure readiness, and
            bounded operational work without exposing provider internals or
            advocate contact details.
          </p>
        </div>
        <Link
          href="/admin"
          className="text-sm font-semibold text-blue-700 hover:text-blue-900"
        >
          Back to administration
        </Link>
      </div>

      <form
        method="get"
        className="mt-8 grid gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:grid-cols-[1fr_1fr_auto_auto] md:items-end"
      >
        <label className="text-sm font-semibold text-gray-900">
          Relationship
          <select
            name="relationship"
            defaultValue={relationshipStatus ?? ""}
            className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2"
          >
            <option value="">All relationships</option>
            <option value="invited">Invited</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="text-sm font-semibold text-gray-900">
          Publication
          <select
            name="publication"
            defaultValue={publicationStatus ?? ""}
            className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2"
          >
            <option value="">All publication states</option>
            <option value="draft">Draft</option>
            <option value="provisioning">Provisioning</option>
            <option value="active">Active</option>
            <option value="failed">Failed</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-md bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800"
        >
          Apply filters
        </button>
        <Link
          href="/admin/advocates"
          className="flex min-h-11 items-center justify-center rounded-md border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
        >
          Clear
        </Link>
      </form>

      <section aria-labelledby="advocate-list-heading" className="mt-8">
        <h2 id="advocate-list-heading" className="sr-only">
          Advocate portal results
        </h2>
        {page.advocates.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-600 shadow-sm">
            No advocate portals match these filters.
          </div>
        ) : (
          <div className="grid gap-4">
            {page.advocates.map((advocate) => (
              <article
                key={advocate.advocateId}
                className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-bold text-gray-950">
                        {advocate.displayName}
                      </h3>
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-900">
                        {statusLabel(advocate.relationshipStatus)}
                      </span>
                      <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-800">
                        {statusLabel(advocate.publicationStatus)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">
                      {advocate.primaryHostname ??
                        `${advocate.slug}.creatorshare.com`}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      Owner: {advocate.ownerDisplayName}
                    </p>
                  </div>

                  <Link
                    href={`/admin/advocates/${encodeURIComponent(advocate.advocateId)}`}
                    className="flex min-h-11 items-center justify-center rounded-md bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                  >
                    Open controls
                  </Link>
                </div>

                <dl className="mt-5 grid gap-3 border-t border-gray-100 pt-5 sm:grid-cols-2 lg:grid-cols-5">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Readiness
                    </dt>
                    <dd className="mt-1 font-semibold text-gray-900">
                      {advocate.readyRequiredIntegrations} of{" "}
                      {advocate.requiredIntegrations}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Open jobs
                    </dt>
                    <dd className="mt-1 font-semibold text-gray-900">
                      {advocate.openProviderJobs}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Pending invitations
                    </dt>
                    <dd className="mt-1 font-semibold text-gray-900">
                      {advocate.pendingInvitations}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Version
                    </dt>
                    <dd className="mt-1 font-semibold text-gray-900">
                      {advocate.advocateVersion}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Updated, UTC
                    </dt>
                    <dd className="mt-1 text-sm font-semibold text-gray-900">
                      {timestampLabel(advocate.updatedAt)}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      {page.nextCursor ? (
        <div className="mt-6 flex justify-end">
          <Link
            href={`/admin/advocates?${nextQuery.toString()}`}
            rel="next"
            className="flex min-h-11 items-center rounded-md border border-gray-300 bg-white px-5 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
          >
            Next 50 portals
          </Link>
        </div>
      ) : null}
    </main>
  )
}
