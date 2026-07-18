"use client"

import { useEffect, useState } from "react"
import { PageNavbar } from "./PageNavbar"
import { ScrollToTop } from "./ScrollToTop"
import { AdvocateExposureTracker } from "./advocates/AdvocateExposureTracker"

export function PageWrapper({ children }: { children: React.ReactNode }) {
  const [isEmbedded, setIsEmbedded] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setIsEmbedded(params.get("embedded") === "true")
  }, [])

  // Show navbar on all pages except embedded mode.
  // isEmbedded starts false so the server always renders the navbar,
  // which means the hero's -88px margin compensation is satisfied from
  // the very first paint and there is no content layout shift.
  const shouldShowNavbar = !isEmbedded

  return (
    <>
      {shouldShowNavbar && <PageNavbar />}
      <AdvocateExposureTracker />
      <div className="w-full max-w-[1200px] mx-auto px-4 max-lg:pb-0 pb-4 max-lg:bg-white">
        {children}
      </div>
      {!isEmbedded && <ScrollToTop />}
    </>
  )
}
