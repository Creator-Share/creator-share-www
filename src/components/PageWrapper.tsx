"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"

const PageNavbar = dynamic(
  () => import("./PageNavbar").then((mod) => mod.PageNavbar),
  { ssr: false }
)

export function PageWrapper({ children }: { children: React.ReactNode }) {
  const [isEmbedded, setIsEmbedded] = useState(false)
  const pathname = usePathname()
  const isHomePage = pathname === "/"

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setIsEmbedded(params.get("embedded") === "true")
  }, [])

  return (
    <>
      {!isEmbedded && !isHomePage && <PageNavbar />}
      <div className="w-full max-w-[1200px] mx-auto p-2 md:p-4 lg:p-8">
        {children}
      </div>
    </>
  )
}
