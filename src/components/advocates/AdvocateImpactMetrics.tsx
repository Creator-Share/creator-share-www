"use client"

import { usePublicSite } from "@/components/advocates/PublicSiteProvider"
import { createPublicSiteImpactMetricItems } from "@/lib/advocates/publicSite"

export function AdvocateImpactMetrics() {
  const publicSite = usePublicSite()
  const metrics = createPublicSiteImpactMetricItems(publicSite)
  if (metrics.length === 0) return null

  return (
    <section
      aria-labelledby="advocate-impact-heading"
      className="relative mx-auto w-full max-w-[1200px] px-4 pb-12 pt-4 sm:px-6 sm:pb-16 lg:px-8"
    >
      <div className="mb-6 max-w-2xl">
        <h2
          id="advocate-impact-heading"
          className="text-2xl font-bold tracking-tight sm:text-3xl"
          style={{ color: "var(--public-site-primary-ink)" }}
        >
          Our sponsorship impact
        </h2>
        <p className="mt-2 text-sm leading-6 text-gray-600 sm:text-base">
          Privacy-protected milestones attributed to {publicSite.displayName}.
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const metricId = `advocate-impact-${metric.key}`

          return (
            <div
              key={metric.key}
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
            >
              <dt
                id={`${metricId}-label`}
                className="text-sm font-semibold leading-5 text-gray-700"
              >
                {metric.label}
              </dt>
              <dd
                aria-describedby={`${metricId}-definition ${metricId}-timing`}
                className="mt-2 text-3xl font-extrabold tracking-tight tabular-nums sm:text-4xl"
                style={{ color: "var(--public-site-primary-ink)" }}
              >
                {metric.formattedValue}
              </dd>
              <p
                id={`${metricId}-definition`}
                className="mt-4 text-sm leading-5 text-gray-600"
              >
                {metric.definition}
              </p>
              <p
                id={`${metricId}-timing`}
                className="mt-3 text-xs font-medium leading-4 text-gray-500"
              >
                {metric.asOf === null ? (
                  metric.timing
                ) : (
                  <time dateTime={metric.asOf}>{metric.timing}</time>
                )}
              </p>
            </div>
          )
        })}
      </dl>
    </section>
  )
}
