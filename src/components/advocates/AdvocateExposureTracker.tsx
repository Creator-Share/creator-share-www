"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

import { resolveAdvocateHost } from "@/lib/advocates/host"
import { isQualifyingAdvocateExposurePagePath } from "@/lib/advocates/publicBrowsePaths"
import { PUBLIC_PATH_CHANGE_EVENT } from "@/lib/advocates/publicPathChanges"

const EXPOSURE_ENDPOINT = "/api/advocates/exposure"

export function AdvocateExposureTracker() {
  const pathname = usePathname()

  useEffect(() => {
    if (window.self !== window.top) return

    const host = resolveAdvocateHost(window.location.host, {
      allowLocalhostDevelopment: process.env.NODE_ENV === "development",
    })
    if (host.kind !== "tenant-candidate") return

    let recordedPath: string | null = null

    const recordCurrentPathWhenVisible = () => {
      const currentPath = window.location.pathname
      if (
        document.visibilityState !== "visible" ||
        currentPath === recordedPath ||
        !isQualifyingAdvocateExposurePagePath(currentPath)
      ) {
        return
      }
      recordedPath = currentPath
      void fetch(EXPOSURE_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        keepalive: true,
      }).catch(() => undefined)
    }

    recordCurrentPathWhenVisible()
    document.addEventListener("visibilitychange", recordCurrentPathWhenVisible)
    window.addEventListener("popstate", recordCurrentPathWhenVisible)
    window.addEventListener(
      PUBLIC_PATH_CHANGE_EVENT,
      recordCurrentPathWhenVisible,
    )
    return () => {
      document.removeEventListener(
        "visibilitychange",
        recordCurrentPathWhenVisible,
      )
      window.removeEventListener("popstate", recordCurrentPathWhenVisible)
      window.removeEventListener(
        PUBLIC_PATH_CHANGE_EVENT,
        recordCurrentPathWhenVisible,
      )
    }
  }, [pathname])

  return null
}
