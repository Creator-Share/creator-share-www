import Link from "next/link"

import type {
  AdvocateAuditActorKind,
  AdvocateAuditAreaKey,
  AdvocateAuditEventKey,
  AdvocateAuditHistoryPage,
} from "@/lib/advocates/admin/audit"

const EVENT_COPY: Readonly<
  Record<AdvocateAuditEventKey, { title: string; summary: string }>
> = Object.freeze({
  "portal.created": {
    title: "Portal created",
    summary: "Creator Share created this advocate portal.",
  },
  "portal.settings.updated": {
    title: "Portal profile updated",
    summary: "The portal profile was updated.",
  },
  "portal.lifecycle.updated": {
    title: "Portal status updated",
    summary: "The portal lifecycle status was updated.",
  },
  "portal.ownership.transferred": {
    title: "Portal ownership transferred",
    summary: "Responsibility for this portal was transferred.",
  },
  "branding.updated": {
    title: "Branding updated",
    summary: "The public portal branding was updated.",
  },
  "catalog.updated": {
    title: "Child catalog updated",
    summary: "The children featured in this portal were updated.",
  },
  "public_metrics.updated": {
    title: "Public metrics updated",
    summary: "The public impact metrics shown on this portal were updated.",
  },
  "team.invitation.issued": {
    title: "Team invitation issued",
    summary: "A new portal team invitation was issued.",
  },
  "team.invitation.revoked": {
    title: "Team invitation revoked",
    summary: "A portal team invitation was revoked.",
  },
  "team.invitation.accepted": {
    title: "Team invitation accepted",
    summary: "A portal team invitation was accepted.",
  },
  "team.member.roles_updated": {
    title: "Team roles updated",
    summary: "A portal team member's roles were updated.",
  },
  "team.member.access_updated": {
    title: "Team access updated",
    summary: "A portal team member's access was updated.",
  },
  "domain.provisioning.requested": {
    title: "Domain provisioning requested",
    summary: "Automated setup began for the portal domain.",
  },
  "domain.publication.completed": {
    title: "Domain publication completed",
    summary: "The portal domain completed its publication checks.",
  },
  "domain.publication.needs_attention": {
    title: "Domain publication needs attention",
    summary: "The portal domain needs attention before publication can finish.",
  },
  "domain.deactivated": {
    title: "Domain deactivated",
    summary: "The public portal domain was deactivated.",
  },
})

const ACTOR_KIND_LABELS: Readonly<Record<AdvocateAuditActorKind, string>> =
  Object.freeze({
    portal_member: "Portal member",
    creator_share_staff: "Creator Share staff",
    automation: "Automation",
  })

const AREA_LABELS: Readonly<Record<AdvocateAuditAreaKey, string>> =
  Object.freeze({
    portal_profile: "Portal profile",
    portal_lifecycle: "Portal lifecycle",
    ownership: "Ownership",
    colors: "Colors",
    logo: "Logo",
    opening_header: "Opening header",
    about: "About biography",
    catalog_mode: "Catalog visibility",
    catalog_selection: "Child selection",
    catalog_order: "Child order",
    public_metric_selection: "Public metrics",
    member_roles: "Member roles",
    member_access: "Member access",
    invitation: "Invitation",
    dns: "DNS",
    tls: "TLS",
    payment_readiness: "Payment readiness",
    provider_readiness: "Provider readiness",
    publication: "Publication",
  })

export function advocateAuditEventCopy(eventKey: AdvocateAuditEventKey): {
  title: string
  summary: string
} {
  return EVENT_COPY[eventKey]
}

export function advocateAuditAreaLabel(area: AdvocateAuditAreaKey): string {
  return AREA_LABELS[area]
}

export function formatAdvocateAuditTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value))
}

export function AuditHistory({
  advocateName,
  slug,
  page,
}: {
  advocateName: string
  slug: string
  page: AdvocateAuditHistoryPage
}) {
  return (
    <div className="grid gap-6">
      <section
        aria-labelledby="advocate-audit-history-heading"
        className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">
          Privacy-safe portal history
        </p>
        <h2
          id="advocate-audit-history-heading"
          className="mt-2 text-2xl font-bold text-gray-950 sm:text-3xl"
        >
          Audit history for {advocateName}
        </h2>
        <p className="mt-3 max-w-3xl leading-7 text-gray-600">
          This history records selected portal administration and publication
          events. Sponsor details, contact data, payment values, change reasons,
          secrets, provider internals, and network forensics are omitted.
        </p>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-500">
          This privacy-safe history begins with the release that introduced this
          view. Earlier changes are not reconstructed.
        </p>
      </section>

      <section
        aria-labelledby="advocate-audit-activity-heading"
        className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3
            id="advocate-audit-activity-heading"
            className="text-xl font-bold text-gray-950"
          >
            Recorded activity
          </h3>
          <Link
            href={`/portal/${slug}/audit`}
            className="inline-flex min-h-11 items-center justify-center self-start rounded-md border border-blue-700 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            Refresh history
          </Link>
        </div>

        {page.entries.length === 0 ? (
          <p
            role="status"
            className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700"
          >
            No privacy-safe activity has been recorded for this portal yet.
          </p>
        ) : (
          <ol className="mt-5 divide-y divide-gray-200 border-y border-gray-200">
            {page.entries.map((entry, index) => {
              const copy = advocateAuditEventCopy(entry.eventKey)
              const headingId = `audit-event-${index + 1}`
              return (
                <li key={entry.cursor} className="py-5 first:pt-0 last:pb-0">
                  <article aria-labelledby={headingId} className="grid gap-3">
                    <div>
                      <h4 id={headingId} className="font-bold text-gray-950">
                        {copy.title}
                      </h4>
                      <p className="mt-1 text-sm leading-6 text-gray-600">
                        {copy.summary}
                      </p>
                    </div>

                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="font-medium text-gray-600">Actor</dt>
                        <dd className="mt-1 text-gray-950">
                          {entry.actorDisplayName}
                          {entry.actorDisplayName !==
                          ACTOR_KIND_LABELS[entry.actorKind] ? (
                            <span className="text-gray-500">
                              {" "}
                              ({ACTOR_KIND_LABELS[entry.actorKind]})
                            </span>
                          ) : null}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-gray-600">Time</dt>
                        <dd className="mt-1 text-gray-950">
                          <time dateTime={entry.occurredAt}>
                            {formatAdvocateAuditTimestamp(entry.occurredAt)}
                          </time>
                        </dd>
                      </div>
                    </dl>

                    <div>
                      <p className="text-sm font-medium text-gray-600">Areas</p>
                      <ul
                        aria-label={`Areas for ${copy.title}`}
                        className="mt-2 flex flex-wrap gap-2"
                      >
                        {entry.areas.map((area) => (
                          <li
                            key={area}
                            className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-900"
                          >
                            {advocateAuditAreaLabel(area)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </article>
                </li>
              )
            })}
          </ol>
        )}

        {page.nextCursor ? (
          <div className="mt-6 border-t border-gray-200 pt-5">
            <Link
              href={`/portal/${slug}/audit?before=${page.nextCursor}`}
              rel="next"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              View older activity
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  )
}
