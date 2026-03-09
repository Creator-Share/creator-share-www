"use client"

import React, { useEffect, useState } from "react"
import { Box, Text } from "@chakra-ui/react"
import dynamic from "next/dynamic"
import { useBeneficiaryPagination } from "@/hooks/useBeneficiaryPagination"
import {
  fetchSponsoredWithRecentActivity,
  SponsoredWithActivity,
} from "@/actions"
import HorizontalSponsorshipRow from "../sponsorships/components/HorizontalSponsorshipRow"
import BeneficiaryModal from "../sponsorships/components/SponsorshipModal"
import { Beneficiaries, Activity } from "@/types"
import { fetchActivitiesByBeneficiaryId } from "@/actions"

const SponsorshipFilters = dynamic(
  () => import("../sponsorships/components/SponsorshipFilters")
)

/**
 * Embed page -- optimised for iframe embedding in external sites.
 * Uses the same horizontal sponsorship row as the main homepage.
 */
const EmbedPage = () => {
  const [sponsored, setSponsored] = useState<SponsoredWithActivity[]>([])
  const [activeBeneficiary, setActiveBeneficiary] = useState<Beneficiaries | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [activities, setActivities] = useState<Activity[]>([])

  const { beneficiaries, hasMore, isLoading, handleFilterChange, loadMore } =
    useBeneficiaryPagination({
      recordsPerPage: 9,
      beneficiaryType: "CHILD",
      autoRetry: true,
    })

  useEffect(() => {
    fetchSponsoredWithRecentActivity().then(setSponsored)
  }, [])

  useEffect(() => {
    if (!activeBeneficiary?.id) { setActivities([]); return }
    fetchActivitiesByBeneficiaryId(activeBeneficiary.id).then(setActivities)
  }, [activeBeneficiary?.id])

  const openModal = (beneficiary: Beneficiaries) => {
    setActiveBeneficiary(beneficiary)
    setIsModalOpen(true)
  }

  // iframe height communication for embedding
  const sendHeight = React.useCallback(() => {
    if (window.self === window.top) return
    try {
      requestAnimationFrame(() => {
        const height = Math.max(
          document.documentElement.offsetHeight,
          document.documentElement.scrollHeight
        )
        const parentOrigin =
          new URLSearchParams(window.location.search).get("parentOrigin") || "*"
        window.parent.postMessage({ type: "resize", height }, parentOrigin)
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
        if (
          !event.origin.includes("share-tanzania.webflow.io") &&
          !event.origin.includes("localhost:3000")
        ) return
        if (event.data?.type === "requestHeight") sendHeight()
      }

      window.addEventListener("message", handleMessage)

      const debouncedSendHeight = () => {
        if (resizeTimeout) clearTimeout(resizeTimeout)
        resizeTimeout = setTimeout(sendHeight, 100)
      }

      resizeObserver = new ResizeObserver(debouncedSendHeight)
      resizeObserver.observe(document.documentElement)

      window.addEventListener("load", sendHeight)
      setTimeout(sendHeight, 100)
      setTimeout(sendHeight, 500)
      setTimeout(sendHeight, 1000)

      return () => {
        window.removeEventListener("message", handleMessage)
        window.removeEventListener("load", sendHeight)
        resizeObserver?.disconnect()
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

      <Box className="w-full">
        <Box className="w-full max-w-7xl mx-auto">
          <SponsorshipFilters onFilterChange={handleFilterChange} />
        </Box>
      </Box>

      <HorizontalSponsorshipRow
        sponsored={sponsored}
        beneficiaries={beneficiaries}
        selectedBeneficiaryId={null}
        hasMore={hasMore}
        isLoading={isLoading}
        onLoadMore={loadMore}
        onOpenModal={openModal}
      />

      {activeBeneficiary && (
        <BeneficiaryModal
          open={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          beneficiary={activeBeneficiary}
          activities={activities}
        />
      )}
    </Box>
  )
}

export default React.memo(EmbedPage)
