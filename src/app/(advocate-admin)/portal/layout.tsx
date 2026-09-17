import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { loadAuthenticatedAdvocatePortalSession } from "@/lib/advocates/admin/access"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Advocate portals | Creator Share",
  robots: { index: false, follow: false },
}

export default async function AdvocatePortalRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await loadAuthenticatedAdvocatePortalSession()
  if (session === null) redirect("/login")

  return children
}
