import { unstable_noStore as noStore } from "next/cache"
import { notFound, redirect } from "next/navigation"

import {
  PublicMetricSettingsClient,
  type AdvocatePublicMetricSettingsViewModel,
} from "@/components/advocates/admin/PublicMetricSettingsClient"
import {
  findAdvocatePortalAccessBySlug,
  loadAuthenticatedAdvocatePortalSession,
} from "@/lib/advocates/admin/access"
import { normalizeAdvocatePublicMetricKeys } from "@/lib/advocates/admin/publicMetricsForm"
import { createAdvocateAdminSettingsRepository } from "@/lib/advocates/admin/settings"
import { createClient } from "@/utils/supabase/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdvocatePublicMetricsPage({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  noStore()

  const session = await loadAuthenticatedAdvocatePortalSession()
  if (session === null) redirect("/login")

  const { slug } = await params
  const portal = findAdvocatePortalAccessBySlug(session.portals, slug)
  if (
    portal === null ||
    !portal.permissions.includes("portal.public_metrics.update")
  ) {
    notFound()
  }

  const client = await createClient()
  const settings =
    await createAdvocateAdminSettingsRepository(client).load(portal)
  const selectedMetricKeys = normalizeAdvocatePublicMetricKeys(
    settings.publicMetricSelections.map((selection) => selection.metricKey),
  )
  if (selectedMetricKeys === null) notFound()

  const viewModel: AdvocatePublicMetricSettingsViewModel = Object.freeze({
    slug: settings.advocate.slug,
    displayName: settings.advocate.displayName,
    advocateVersion: settings.advocate.advocateVersion,
    selectedMetricKeys,
  })

  return (
    <PublicMetricSettingsClient
      key={`${viewModel.slug}:${viewModel.advocateVersion}`}
      settings={viewModel}
    />
  )
}
