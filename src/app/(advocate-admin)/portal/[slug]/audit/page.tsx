import { unstable_noStore as noStore } from "next/cache"
import { notFound, redirect } from "next/navigation"

import { AuditHistory } from "@/components/advocates/admin/AuditHistory"
import {
  findAdvocatePortalAccessBySlug,
  loadAuthenticatedAdvocatePortalSession,
} from "@/lib/advocates/admin/access"
import {
  createAdvocateAuditHistoryRepository,
  parseAdvocateAuditHistoryPageQuery,
} from "@/lib/advocates/admin/audit"
import { createClient } from "@/utils/supabase/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdvocateAuditHistoryPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}>) {
  noStore()

  const session = await loadAuthenticatedAdvocatePortalSession()
  if (session === null) redirect("/login")

  const { slug } = await params
  const portal = findAdvocatePortalAccessBySlug(session.portals, slug)
  if (portal === null || !portal.permissions.includes("portal.audit.view")) {
    notFound()
  }

  const query = parseAdvocateAuditHistoryPageQuery(await searchParams)
  if (query === null) notFound()

  const client = await createClient()
  const page = await createAdvocateAuditHistoryRepository(client).load(
    portal.advocateId,
    query.beforeCursor,
  )

  return (
    <AuditHistory
      advocateName={portal.displayName}
      slug={portal.slug}
      page={page}
    />
  )
}
