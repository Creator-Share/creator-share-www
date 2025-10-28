"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { useAuthStore } from "@/store/authStore"

const PageNavbar = dynamic(
  () => import("./PageNavbar").then((mod) => mod.PageNavbar),
  { ssr: false }
)

export function PageWrapper({ children }: { children: React.ReactNode }) {
  const [isEmbedded, setIsEmbedded] = useState(false)
  const pathname = usePathname()
  const isHomePage = pathname === "/"
  const user = useAuthStore((state) => state.user)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setIsEmbedded(params.get("embedded") === "true")
  }, [])

  // Show navbar if: not embedded AND (not homepage OR user is logged in)
  const shouldShowNavbar = !isEmbedded && (!isHomePage || !!user)

  return (
    <>
      {shouldShowNavbar && <PageNavbar />}
      <div className="w-full max-w-[1200px] mx-auto p-2 md:p-4 lg:p-8">
        {children}
      </div>
    </>
  )
}
