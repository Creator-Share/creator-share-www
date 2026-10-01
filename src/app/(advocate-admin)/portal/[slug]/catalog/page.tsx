import { unstable_noStore as noStore } from "next/cache"
import { notFound, redirect } from "next/navigation"

import {
  CatalogSettingsClient,
  type AdvocateCatalogSettingsViewModel,
} from "@/components/advocates/admin/CatalogSettingsClient"
import {
  findAdvocatePortalAccessBySlug,
  loadAuthenticatedAdvocatePortalSession,
} from "@/lib/advocates/admin/access"
import { loadAdvocateCatalogAdministration } from "@/lib/advocates/admin/catalog"
import { createServiceRoleClient } from "@/utils/supabase/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdvocateCatalogPage({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  noStore()

  const session = await loadAuthenticatedAdvocatePortalSession()
  if (session === null) redirect("/login")

  const { slug } = await params
  const portal = findAdvocatePortalAccessBySlug(session.portals, slug)
  if (
    portal === null ||
    !portal.permissions.includes("portal.beneficiaries.manage")
  ) {
    notFound()
  }

  const catalog = await loadAdvocateCatalogAdministration(
    createServiceRoleClient(),
    {
      advocateId: portal.advocateId,
      actorUserId: session.user.id,
    },
  )

  const viewModel: AdvocateCatalogSettingsViewModel = Object.freeze({
    advocateId: portal.advocateId,
    actorUserId: session.user.id,
    slug: portal.slug,
    displayName: portal.displayName,
    advocateVersion: catalog.advocateVersion,
    mode: catalog.mode,
    selections: catalog.selections,
    beneficiaries: catalog.beneficiaries,
    selectionLimit: catalog.selectionLimit,
  })

  return (
    <CatalogSettingsClient
      key={`${viewModel.advocateId}:${viewModel.actorUserId}:${viewModel.slug}:${viewModel.advocateVersion}`}
      settings={viewModel}
    />
  )
}
