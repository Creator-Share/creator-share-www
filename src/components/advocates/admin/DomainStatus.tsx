import type { AdvocatePortalAccess } from "@/lib/advocates/admin/access"
import {
  activeAdvocatePublicPortalHref,
  advocatePortalDisplayHostname,
} from "@/components/advocates/admin/PortalShell"
import type { AdvocateHostEnvironment } from "@/lib/advocates/host"

type DomainStatusPortal = Pick<
  AdvocatePortalAccess,
  | "canonicalHostname"
  | "displayName"
  | "domainStatus"
  | "publicationStatus"
  | "relationshipStatus"
>

export interface AdvocateDomainStatusPresentation {
  hostname: string
  domainStatusLabel: string
  publicationStatusLabel: string
  summary: string
  publicHref: string | null
}

function readableStatus(value: string): string {
  return value
    .split("_")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ")
}

function domainSummary(portal: DomainStatusPortal): string {
  if (portal.relationshipStatus === "archived") {
    return "This portal is archived and its public domain is unavailable."
  }
  if (portal.relationshipStatus === "suspended") {
    return "This portal relationship is suspended, so its public domain is unavailable."
  }
  if (portal.relationshipStatus !== "active") {
    return "This portal relationship is not active, so its public domain is unavailable."
  }
  if (portal.canonicalHostname === null || portal.domainStatus === null) {
    return "A Creator Share subdomain has not been assigned yet."
  }

  switch (portal.domainStatus) {
    case "pending":
      return "Automated domain setup has not started yet."
    case "provisioning":
      return "Automated domain setup is in progress."
    case "verifying":
      return "Automated readiness checks are in progress."
    case "failed":
      return "Creator Share must review domain setup before publication can continue."
    case "redirecting":
      return "This domain is being retired and is not the active public destination."
    case "disabled":
      return "This domain is disabled and cannot serve the public portal."
    case "active":
      return portal.publicationStatus === "active"
        ? "The public portal is available on this domain."
        : "The domain is ready. The public portal remains unavailable until publication is approved."
  }
}

export function buildAdvocateDomainStatusPresentation(
  portal: DomainStatusPortal,
  environment: AdvocateHostEnvironment = process.env,
): AdvocateDomainStatusPresentation {
  return Object.freeze({
    hostname: advocatePortalDisplayHostname(
      portal.canonicalHostname,
      environment,
    ),
    domainStatusLabel: portal.domainStatus
      ? readableStatus(portal.domainStatus)
      : "Not yet assigned",
    publicationStatusLabel: readableStatus(portal.publicationStatus),
    summary: domainSummary(portal),
    publicHref: activeAdvocatePublicPortalHref(portal, environment),
  })
}

export function DomainStatus({ portal }: { portal: DomainStatusPortal }) {
  const status = buildAdvocateDomainStatusPresentation(portal)

  return (
    <section
      aria-labelledby="advocate-domain-heading"
      className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <h2 id="advocate-domain-heading" className="text-2xl font-bold">
        Domain status
      </h2>
      <p className="mt-2 max-w-3xl text-gray-600">
        Creator Share assigns and manages this portal&apos;s subdomain
        automatically. No domain setup is required from your team.
      </p>

      <div
        role="status"
        className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950"
      >
        {status.summary}
      </div>

      <dl className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2">
        <div className="border-t border-gray-100 pt-4">
          <dt className="text-sm font-medium text-gray-500">Public domain</dt>
          <dd className="mt-1 break-words font-semibold text-gray-950">
            {status.hostname}
          </dd>
        </div>
        <div className="border-t border-gray-100 pt-4">
          <dt className="text-sm font-medium text-gray-500">Domain status</dt>
          <dd className="mt-1 font-semibold text-gray-950">
            {status.domainStatusLabel}
          </dd>
        </div>
        <div className="border-t border-gray-100 pt-4">
          <dt className="text-sm font-medium text-gray-500">
            Publication status
          </dt>
          <dd className="mt-1 font-semibold text-gray-950">
            {status.publicationStatusLabel}
          </dd>
        </div>
      </dl>

      {status.publicHref ? (
        <a
          href={status.publicHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 inline-flex min-h-11 items-center justify-center rounded-md border border-blue-700 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          View public portal
          <span className="sr-only"> in a new tab</span>
        </a>
      ) : null}
    </section>
  )
}
