import { notFound, redirect } from "next/navigation"

import {
  BrandingSettingsClient,
  type AdvocateBrandingSettingsViewModel,
} from "@/components/advocates/admin/BrandingSettingsClient"
import {
  findAdvocatePortalAccessBySlug,
  loadAuthenticatedAdvocatePortalSession,
} from "@/lib/advocates/admin/access"
import { resolveAdvocateBrandingEditability } from "@/lib/advocates/admin/brandingForm"
import { createAdvocateAdminSettingsRepository } from "@/lib/advocates/admin/settings"
import { createClient } from "@/utils/supabase/server"

export const dynamic = "force-dynamic"

const ADVOCATE_ASSET_BUCKET = "advocate-assets"

export default async function AdvocateBrandingSettingsPage({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  const session = await loadAuthenticatedAdvocatePortalSession()
  if (session === null) redirect("/login")

  const { slug } = await params
  const portal = findAdvocatePortalAccessBySlug(session.portals, slug)
  if (portal === null) notFound()

  const client = await createClient()
  const settings =
    await createAdvocateAdminSettingsRepository(client).load(portal)
  const logoUrl = settings.branding.logoStoragePath
    ? client.storage
        .from(ADVOCATE_ASSET_BUCKET)
        .getPublicUrl(settings.branding.logoStoragePath).data.publicUrl
    : null
  const editability = resolveAdvocateBrandingEditability({
    hasBrandingPermission: portal.permissions.includes(
      "portal.branding.update",
    ),
    relationshipStatus: settings.advocate.relationshipStatus,
    publicationStatus: settings.advocate.publicationStatus,
  })
  const viewModel: AdvocateBrandingSettingsViewModel = Object.freeze({
    slug: settings.advocate.slug,
    displayName: settings.advocate.displayName,
    advocateVersion: settings.advocate.advocateVersion,
    canEdit: editability.canEdit,
    readOnlyReason: editability.readOnlyReason,
    primaryColor: settings.branding.primaryColor,
    accentColor: settings.branding.accentColor,
    logoStoragePath: settings.branding.logoStoragePath,
    logoUrl,
    logoAltText: settings.branding.logoAltText,
    openingHeaderHtml: settings.branding.openingHeaderHtml,
    aboutBiographyHtml: settings.branding.aboutBiographyHtml,
  })

  return (
    <BrandingSettingsClient
      key={`${viewModel.slug}:${viewModel.advocateVersion}`}
      settings={viewModel}
    />
  )
}
