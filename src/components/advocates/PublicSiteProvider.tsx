"use client"

import { createContext, useContext, type ReactNode } from "react"

import type { PublicSite } from "@/lib/advocates/publicSite"
import { createPublicSiteCssVariables } from "@/lib/advocates/publicSiteTheme"

const PublicSiteContext = createContext<PublicSite | null>(null)

export function PublicSiteProvider({
  site,
  children,
}: {
  site: PublicSite
  children: ReactNode
}) {
  return (
    <PublicSiteContext.Provider value={site}>
      <div
        className="flex min-h-screen flex-1 flex-col"
        data-public-site-kind={site.kind}
        style={createPublicSiteCssVariables(site)}
      >
        {children}
      </div>
    </PublicSiteContext.Provider>
  )
}

export function usePublicSite(): PublicSite {
  const site = useContext(PublicSiteContext)
  if (site === null) {
    throw new Error("usePublicSite must be used within PublicSiteProvider")
  }
  return site
}
