"use client"

import { useEffect } from "react"

import { resolveAdvocateHost } from "@/lib/advocates/host"

const EXPOSURE_ENDPOINT = "/api/advocates/exposure"

export function AdvocateExposureTracker() {
  useEffect(() => {
    const host = resolveAdvocateHost(window.location.host, {
      allowLocalhostDevelopment: process.env.NODE_ENV === "development",
    })
    if (host.kind !== "tenant-candidate") return

    let recorded = false

    const recordWhenVisible = () => {
      if (recorded || document.visibilityState !== "visible") return
      recorded = true
      void fetch(EXPOSURE_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        keepalive: true,
      }).catch(() => undefined)
    }

    recordWhenVisible()
    document.addEventListener("visibilitychange", recordWhenVisible)
    return () => {
      document.removeEventListener("visibilitychange", recordWhenVisible)
    }
  }, [])

  return null
}
