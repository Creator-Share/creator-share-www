"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

import {
  isAdvocateStagingEnvironmentEnabled,
  resolveAdvocateHost,
} from "@/lib/advocates/host"
import { recordAdvocateExposureThroughBroker } from "@/lib/advocates/exposureBrokerClient"
import { createAdvocateExposurePageRetryController } from "@/lib/advocates/exposureBrokerTracker"
import { isQualifyingAdvocateExposurePagePath } from "@/lib/advocates/publicBrowsePaths"
import { PUBLIC_PATH_CHANGE_EVENT } from "@/lib/advocates/publicPathChanges"

export function AdvocateExposureTracker() {
  const pathname = usePathname()
  const completedPaths = useRef(new Set<string>())
  const pendingPaths = useRef(new Map<string, Promise<boolean>>())

  useEffect(() => {
    if (window.self !== window.top) return

    const allowStagingEnvironment = isAdvocateStagingEnvironmentEnabled({
      NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
    })
    const host = resolveAdvocateHost(window.location.host, {
      allowLocalhostDevelopment: process.env.NODE_ENV === "development",
      allowStagingEnvironment,
    })
    if (host.kind !== "tenant-candidate") return
    if (completedPaths.current.has(pathname)) return

    const pageHost = window.location.host
    const recordExposure = () => {
      if (completedPaths.current.has(pathname)) return Promise.resolve(true)

      const existingRequest = pendingPaths.current.get(pathname)
      if (existingRequest !== undefined) return existingRequest

      const request = recordAdvocateExposureThroughBroker(
        {
          pageHost,
          pagePath: pathname,
        },
        { allowStagingEnvironment },
      )
        .catch(() => false)
        .then((accepted) => {
          if (accepted) completedPaths.current.add(pathname)
          return accepted
        })
      pendingPaths.current.set(pathname, request)
      void request.finally(() => {
        if (pendingPaths.current.get(pathname) === request) {
          pendingPaths.current.delete(pathname)
        }
      })
      return request
    }

    const controller = createAdvocateExposurePageRetryController({
      isCurrentEligiblePath: () => {
        return (
          window.location.host === pageHost &&
          window.location.pathname === pathname &&
          isQualifyingAdvocateExposurePagePath(pathname)
        )
      },
      isVisible: () => document.visibilityState === "visible",
      onAccepted: () => completedPaths.current.add(pathname),
      recordExposure,
    })

    const notifyEnvironmentChange = () => controller.notifyEnvironmentChange()

    controller.start()
    document.addEventListener("visibilitychange", notifyEnvironmentChange)
    window.addEventListener("popstate", notifyEnvironmentChange)
    window.addEventListener(PUBLIC_PATH_CHANGE_EVENT, notifyEnvironmentChange)
    return () => {
      controller.dispose()
      document.removeEventListener("visibilitychange", notifyEnvironmentChange)
      window.removeEventListener("popstate", notifyEnvironmentChange)
      window.removeEventListener(
        PUBLIC_PATH_CHANGE_EVENT,
        notifyEnvironmentChange,
      )
    }
  }, [pathname])

  return null
}
