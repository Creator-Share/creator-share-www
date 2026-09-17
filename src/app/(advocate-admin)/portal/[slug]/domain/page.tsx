import { unstable_noStore as noStore } from "next/cache"
import { notFound, redirect } from "next/navigation"

import { DomainStatus } from "@/components/advocates/admin/DomainStatus"
import {
  findAdvocatePortalAccessBySlug,
  loadAuthenticatedAdvocatePortalSession,
} from "@/lib/advocates/admin/access"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdvocateDomainStatusPage({
  params,
}: Readonly<{ params: Promise<{ slug: string }> }>) {
  noStore()

  const session = await loadAuthenticatedAdvocatePortalSession()
  if (session === null) redirect("/login")

  const { slug } = await params
  const portal = findAdvocatePortalAccessBySlug(session.portals, slug)
  if (portal === null || !portal.permissions.includes("portal.domains.view")) {
    notFound()
  }

  return <DomainStatus portal={portal} />
}
