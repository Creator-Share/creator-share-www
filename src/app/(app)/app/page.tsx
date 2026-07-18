"use client"
import { useEffect, useState, useCallback } from "react"
import { DataTable } from "@/components/admin-ui/Tables/data-table"
import { columns, type Subscription } from "./columns"
import { createClient } from "@/utils/supabase/client"
import { Box, Heading, Text, Button } from "@chakra-ui/react"
import { useAuthStore } from "@/store/authStore"
import { ColumnDef } from "@tanstack/react-table"
import { BeneficiarySelectionModal } from "./components/BeneficiarySelectionModal"
import { OneTimeSponsorshipHistory } from "./components/OneTimeSponsorshipHistory"
import type { SponsorOneTimeHistoryItem } from "@/lib/sponsorships/sponsorAccountHistory"
import { presentSubscriptionSubject } from "@/lib/sponsorships/subscriptionPresentation"
import { parseSponsorRecurringSponsorships } from "@/lib/sponsorships/sponsorRecurringSponsorships"

interface SponsorHistoryPageResponse {
  items: SponsorOneTimeHistoryItem[]
  nextCursor: string | null
}

async function fetchSponsorHistoryPage(
  cursor: string | null = null,
): Promise<SponsorHistoryPageResponse> {
  const search = new URLSearchParams({ limit: "20" })
  if (cursor) search.set("cursor", cursor)
  const response = await fetch(`/api/sponsor-account/history?${search}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  })
  if (!response.ok) throw new Error("sponsor_history_unavailable")

  const payload = (await response.json()) as Partial<SponsorHistoryPageResponse>
  if (
    !Array.isArray(payload.items) ||
    (payload.nextCursor !== null &&
      typeof payload.nextCursor !== "string")
  ) {
    throw new Error("sponsor_history_malformed")
  }
  return {
    items: payload.items,
    nextCursor: payload.nextCursor ?? null,
  }
}

async function fetchRecurringSponsorships(): Promise<Subscription[]> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc(
    "list_my_recurring_sponsorships",
  )
  if (error) throw error
  return parseSponsorRecurringSponsorships(data)
}

const UserDashboard = () => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [oneTimeHistory, setOneTimeHistory] = useState<
    SponsorOneTimeHistoryItem[]
  >([])
  const [historyCursor, setHistoryCursor] = useState<string | null>(null)
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<string | null>(null)
  const { user } = useAuthStore()

  const fetchSubscriptions = useCallback(async () => {
    if (!user) return

    const [subscriptionsResult, historyResult] = await Promise.allSettled([
      fetchRecurringSponsorships(),
      fetchSponsorHistoryPage(),
    ])

    if (subscriptionsResult.status === "rejected") {
      console.error("Error fetching subscriptions")
    } else {
      setSubscriptions(subscriptionsResult.value)
    }

    if (historyResult.status === "fulfilled") {
      setOneTimeHistory(historyResult.value.items)
      setHistoryCursor(historyResult.value.nextCursor)
      setHistoryError(null)
    } else {
      console.error("Error fetching one time sponsorship history")
      setHistoryError(
        "We could not load your one time sponsorship history. Please try again.",
      )
    }
    setLoading(false)
  }, [user])

  const loadMoreHistory = useCallback(async () => {
    if (!historyCursor || historyLoadingMore) return
    setHistoryLoadingMore(true)
    setHistoryError(null)
    try {
      const page = await fetchSponsorHistoryPage(historyCursor)
      setOneTimeHistory((existing) => {
        const seen = new Set(
          existing.map((item) => item.sponsorshipIntentId),
        )
        return [
          ...existing,
          ...page.items.filter(
            (item) => !seen.has(item.sponsorshipIntentId),
          ),
        ]
      })
      setHistoryCursor(page.nextCursor)
    } catch {
      setHistoryError(
        "We could not load more sponsorships. Please try again.",
      )
    } finally {
      setHistoryLoadingMore(false)
    }
  }, [historyCursor, historyLoadingMore])

  useEffect(() => {
    fetchSubscriptions()
  }, [fetchSubscriptions])

  const handleChooseChild = (subscriptionId: string) => {
    setSelectedSubscriptionId(subscriptionId)
    setIsModalOpen(true)
  }

  const handleAssignmentSuccess = () => {
    // Refresh subscriptions after successful assignment
    fetchSubscriptions()
  }

  if (loading) {
    return <div>Loading...</div>
  }

  const completedSubscriptions = subscriptions.filter(
    (subscription) => subscription.status === "complete",
  )
  const subjectFor = (subscription: Subscription) =>
    presentSubscriptionSubject({
      subjectKind: subscription.subject_kind,
      partnershipProject: subscription.partnership_project,
      beneficiaryId: subscription.beneficiary_id,
    })
  const blindSponsorships = completedSubscriptions.filter(
    (subscription) => subjectFor(subscription).subjectKind === "blind",
  )
  const partnershipSubscriptions = completedSubscriptions.filter(
    (subscription) => subjectFor(subscription).subjectKind === "partnership",
  )
  const matchedSponsorships = completedSubscriptions.filter(
    (subscription) =>
      subjectFor(subscription).subjectKind === "standard" &&
      subscription.beneficiary_id !== null,
  )

  return (
    <Box className="container mx-auto py-8">
      <Box className="mb-8">
        <Heading size="lg" mb={2}>
          My Sponsorships
        </Heading>
        <Text color="gray.600">
          Manage your active sponsorships and view payment history
        </Text>
      </Box>

      {/* Blind Sponsorship Status Alert */}
      {blindSponsorships.length > 0 && (
        <Box
          className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg"
        >
          <Text fontWeight="semibold" color="yellow.800" mb={2}>
            📋 Awaiting Match
          </Text>
          <Text fontSize="sm" color="yellow.700" mb={3}>
            You have {blindSponsorships.length} blind sponsorship
            {blindSponsorships.length > 1 ? "s" : ""} waiting to be matched with a child.
            You can either wait for us to automatically match you, or choose a child yourself!
          </Text>
          <Button
            size="sm"
            colorScheme="blue"
            onClick={() => handleChooseChild(blindSponsorships[0].id)}
          >
            Choose a Child
          </Button>
        </Box>
      )}

      {/* Summary Stats */}
      {subscriptions.length > 0 && (
        <Box className="mb-6 flex gap-4">
          <Box className="px-4 py-2 bg-blue-50 rounded-lg">
            <Text fontSize="sm" color="gray.600">
              Active Sponsorships
            </Text>
            <Text fontSize="xl" fontWeight="bold" color="blue.700">
              {matchedSponsorships.length + partnershipSubscriptions.length}
            </Text>
          </Box>
          {blindSponsorships.length > 0 && (
            <Box className="px-4 py-2 bg-yellow-50 rounded-lg">
              <Text fontSize="sm" color="gray.600">
                Awaiting Match
              </Text>
              <Text fontSize="xl" fontWeight="bold" color="yellow.700">
                {blindSponsorships.length}
              </Text>
            </Box>
          )}
          {partnershipSubscriptions.length > 0 && (
            <Box className="px-4 py-2 bg-purple-50 rounded-lg">
              <Text fontSize="sm" color="gray.600">
                Partnerships
              </Text>
              <Text fontSize="xl" fontWeight="bold" color="purple.700">
                {partnershipSubscriptions.length}
              </Text>
            </Box>
          )}
        </Box>
      )}

      <DataTable
        columns={columns as unknown as ColumnDef<unknown, unknown>[]}
        data={subscriptions.map((subscription) => ({
          ...subscription,
          onChooseChild:
            subjectFor(subscription).subjectKind === "blind"
              ? handleChooseChild
              : undefined,
        }))}
        controls="bottom"
        tableHeight="h-[50vh]"
      />

      <OneTimeSponsorshipHistory
        items={oneTimeHistory}
        nextCursor={historyCursor}
        loadingMore={historyLoadingMore}
        error={historyError}
        onLoadMore={loadMoreHistory}
      />

      {/* Beneficiary Selection Modal */}
      {selectedSubscriptionId && (
        <BeneficiarySelectionModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false)
            setSelectedSubscriptionId(null)
          }}
          subscriptionId={selectedSubscriptionId}
          onSuccess={handleAssignmentSuccess}
        />
      )}
    </Box>
  )
}

export default UserDashboard
