"use client"
import { useEffect, useState } from "react"
import { DataTable } from "@/components/admin-ui/Tables/data-table"
import { columns, type Subscription } from "./columns"
import { createClient } from "@/utils/supabase/client"
import { Box, Heading, Text } from "@chakra-ui/react"
import { useAuthStore } from "@/store/authStore"
import { ColumnDef } from "@tanstack/react-table"

const UserDashboard = () => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const { user } = useAuthStore()

  useEffect(() => {
    async function fetchSubscriptions() {
      if (!user) return

      const supabase = createClient()
      const { data, error } = await supabase
        .from("subscriptions")
        .select(
          `
          *,
          child:beneficiaries(
            name,
            username
          )
        `,
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })

      if (error) {
        console.error("Error fetching subscriptions:", error)
        return
      }

      setSubscriptions(data || [])
      setLoading(false)
    }

    fetchSubscriptions()
  }, [user])

  if (loading) {
    return <div>Loading...</div>
  }

  // Count blind sponsorships awaiting match
  const blindSponsorships = subscriptions.filter(
    (sub) => !sub.beneficiary_id && sub.status === "complete"
  )
  const matchedSponsorships = subscriptions.filter(
    (sub) => sub.beneficiary_id && sub.status === "complete"
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
          <Text fontSize="sm" color="yellow.700">
            You have {blindSponsorships.length} blind sponsorship
            {blindSponsorships.length > 1 ? "s" : ""} waiting to be matched with a child.
            You&apos;ll receive an email notification once we&apos;ve found a match!
          </Text>
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
              {matchedSponsorships.length}
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
        </Box>
      )}

      <DataTable
        columns={columns as unknown as ColumnDef<unknown, unknown>[]}
        data={subscriptions}
        controls="bottom"
        tableHeight="h-[50vh]"
      />
    </Box>
  )
}

export default UserDashboard
