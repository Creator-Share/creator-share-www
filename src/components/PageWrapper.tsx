"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"
import { ScrollToTop } from "./ScrollToTop"

const PageNavbar = dynamic(
  () => import("./PageNavbar").then((mod) => mod.PageNavbar),
  { ssr: false }
)

export function PageWrapper({ children }: { children: React.ReactNode }) {
  const [isEmbedded, setIsEmbedded] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setIsEmbedded(params.get("embedded") === "true")
  }, [])

  // Show navbar on all pages except embedded mode
  const shouldShowNavbar = !isEmbedded

  return (
    <>
      {shouldShowNavbar && <PageNavbar />}
      <div className="w-full max-w-[1200px] mx-auto p-4">
        {children}
      </div>
      {/* Floating scroll-to-top button - shown on all pages except embedded */}
      {!isEmbedded && <ScrollToTop />}
    </>
  )
}
