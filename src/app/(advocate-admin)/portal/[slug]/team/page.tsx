import { notFound, redirect } from "next/navigation"

import { InvitationSettingsClient } from "@/components/advocates/admin/InvitationSettingsClient"
import { TeamSettingsClient } from "@/components/advocates/admin/TeamSettingsClient"
import {
  findAdvocatePortalAccessBySlug,
  loadAuthenticatedAdvocatePortalSession,
} from "@/lib/advocates/admin/access"
import { createAdvocateTeamRepository } from "@/lib/advocates/admin/team"
import { loadAdvocatePendingInvitations } from "@/lib/advocates/invitations/administration"
import { createClient } from "@/utils/supabase/server"

export const dynamic = "force-dynamic"

export default async function AdvocateTeamPage({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  const session = await loadAuthenticatedAdvocatePortalSession()
  if (session === null) redirect("/login")

  const { slug } = await params
  const portal = findAdvocatePortalAccessBySlug(session.portals, slug)
  if (portal === null || !portal.permissions.includes("portal.members.view")) {
    notFound()
  }

  const client = await createClient()
  const [members, invitations] = await Promise.all([
    createAdvocateTeamRepository(client).load(portal),
    loadAdvocatePendingInvitations(client, portal.advocateId),
  ])

  return (
    <>
      <TeamSettingsClient
        slug={portal.slug}
        initialMembers={members}
        canManage={portal.permissions.includes("portal.members.manage")}
      />
      <InvitationSettingsClient
        slug={portal.slug}
        initialInvitations={invitations}
        canInvite={portal.permissions.includes("portal.members.invite")}
      />
    </>
  )
}
