import { notFound, redirect } from "next/navigation"

import { PortalShell } from "@/components/advocates/admin/PortalShell"
import {
  findAdvocatePortalAccessBySlug,
  loadAuthenticatedAdvocatePortalSession,
} from "@/lib/advocates/admin/access"

export default async function AdvocatePortalLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ slug: string }>
}>) {
  const session = await loadAuthenticatedAdvocatePortalSession()
  if (session === null) redirect("/login")

  const { slug } = await params
  const portal = findAdvocatePortalAccessBySlug(session.portals, slug)
  if (portal === null) notFound()

  return <PortalShell portal={portal}>{children}</PortalShell>
}
