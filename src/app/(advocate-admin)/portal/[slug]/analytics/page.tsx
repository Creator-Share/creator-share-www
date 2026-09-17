import { unstable_noStore as noStore } from "next/cache"
import { notFound, redirect } from "next/navigation"

import { AnalyticsDashboard } from "@/components/advocates/admin/AnalyticsDashboard"
import {
  findAdvocatePortalAccessBySlug,
  loadAuthenticatedAdvocatePortalSession,
} from "@/lib/advocates/admin/access"
import { createAdvocateAnalyticsRepository } from "@/lib/advocates/admin/analytics"
import { createClient } from "@/utils/supabase/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdvocateAnalyticsPage({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  noStore()

  const session = await loadAuthenticatedAdvocatePortalSession()
  if (session === null) redirect("/login")

  const { slug } = await params
  const portal = findAdvocatePortalAccessBySlug(session.portals, slug)
  if (
    portal === null ||
    !portal.permissions.includes("portal.analytics.view")
  ) {
    notFound()
  }

  const client = await createClient()
  const snapshot = await createAdvocateAnalyticsRepository(client).load(
    portal.advocateId,
  )

  return (
    <AnalyticsDashboard advocateName={portal.displayName} snapshot={snapshot} />
  )
}
