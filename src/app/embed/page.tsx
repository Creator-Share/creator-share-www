"use client"

import React, { useEffect, useRef } from "react"
import { Box, Text } from "@chakra-ui/react"
import dynamic from "next/dynamic"
import { useBeneficiaryPagination } from "@/hooks/useBeneficiaryPagination"

const SponsorshipFilters = dynamic(
  () => import("../sponsorships/components/SponsorshipFilters")
)
const ChildListings = dynamic(
  () => import("../sponsorships/components/SponsorshipListings")
)

/**
 * Embed page - Optimized for iframe embedding in external sites
 * This page is designed to be embedded via iframe with ?embedded=true parameter
 * For the main site experience, users should visit the homepage (/)
 */
const EmbedPage = () => {
  const childListingsRef = useRef<HTMLDivElement>(null)

  const { beneficiaries, hasMore, isLoading, handleFilterChange, loadMore } =
    useBeneficiaryPagination({
      recordsPerPage: 9,
      beneficiaryType: "CHILD",
      autoRetry: true,
    })

  // iframe height communication for embedding
  const sendHeight = React.useCallback(() => {
    if (window.self === window.top) return

    try {
      requestAnimationFrame(() => {
        const height = Math.max(
          document.documentElement.offsetHeight,
          document.documentElement.scrollHeight
        )

        const urlParams = new URLSearchParams(window.location.search)
        const parentOrigin = urlParams.get("parentOrigin") || "*"

        window.parent.postMessage(
          {
            type: "resize",
            height: height,
          },
          parentOrigin
        )
      })
    } catch (error) {
      console.error("[Embed Frame] Error sending height:", error)
    }
  }, [])

  useEffect(() => {
    if (window.self === window.top) return

    let resizeObserver: ResizeObserver | null = null
    let resizeTimeout: NodeJS.Timeout | null = null

    try {
      const handleMessage = (event: MessageEvent) => {
        // TODO: Respect .env instead of hardcode
        if (
          !event.origin.includes("share-tanzania.webflow.io") &&
          !event.origin.includes("localhost:3000")
        ) {
          return
        }

        if (event.data?.type === "requestHeight") {
          sendHeight()
        }
      }

      window.addEventListener("message", handleMessage)

      const debouncedSendHeight = () => {
        if (resizeTimeout) clearTimeout(resizeTimeout)
        resizeTimeout = setTimeout(sendHeight, 100)
      }

      const observer = new ResizeObserver(debouncedSendHeight)
      resizeObserver = observer

      observer.observe(document.documentElement)

      window.addEventListener("load", sendHeight)
      setTimeout(sendHeight, 100)
      setTimeout(sendHeight, 500)
      setTimeout(sendHeight, 1000)

      return () => {
        window.removeEventListener("message", handleMessage)
        window.removeEventListener("load", sendHeight)
        if (resizeObserver) resizeObserver.disconnect()
        if (resizeTimeout) clearTimeout(resizeTimeout)
      }
    } catch (error) {
      console.error("[Embed Frame] Error setting up resize handling:", error)
    }
  }, [sendHeight])

  return (
    <Box className="px-6 py-6 md:px-12 md:py-12">
      <Box className="text-center justify-center my-12">
        <Text className="text-[#1C3C8C] font-semibold text-5xl mb-4">
          Sponsoring a Child with Creator Share
        </Text>
        <Text className="text-base font-normal text-[#03150E99]">
          Sponsoring a child brings hope to those facing isolation, poverty, or
          neglect. Your support provides a safe environment where vulnerable
          children can thrive.
        </Text>
      </Box>

      {/* Filters */}
      <Box className="w-full">
        <Box className="w-full max-w-7xl mx-auto">
          <SponsorshipFilters onFilterChange={handleFilterChange} />
        </Box>
      </Box>

      {/* Listings */}
      <ChildListings
        ref={childListingsRef}
        beneficiaryData={beneficiaries}
        selectedBeneficiaryId={null}
        selectedCountry={null}
        mapBounds={undefined}
        setSelectedBeneficiaryId={() => {}}
        onLoadMore={loadMore}
        hasMore={hasMore}
        isLoading={isLoading}
      />
    </Box>
  )
}

export default React.memo(EmbedPage)
