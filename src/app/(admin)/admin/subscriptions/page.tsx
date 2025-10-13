"use client"

import { useEffect, useState } from "react"
import { DataTable } from "@/components/admin-ui/Tables/data-table"
import { columns, type AdminSubscription } from "@/app/(admin)/admin/subscriptions/columns"
import { createClient } from "@/utils/supabase/client"
import { Box, Heading, Text, Button, Flex, Badge } from "@chakra-ui/react"
import { ColumnDef } from "@tanstack/react-table"
import AdminPageLayout from "@/components/admin-ui/AdminPageLayout"
import { MdRefresh } from "react-icons/md"
import { toaster } from "@/components/ui/toaster"

const AdminSubscriptionsPage = () => {
  const [subscriptions, setSubscriptions] = useState<AdminSubscription[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [searchValue, setSearchValue] = useState("")

  const fetchSubscriptions = async () => {
    try {
      setRefreshing(true)
      const supabase = createClient()
      
      // Try basic query first
      let data, error
      
      // First, let's check if the subscriptions table exists and get basic info
      console.log("Attempting to fetch subscriptions...")
      
      try {
        // Try the most basic query first
        const basicResult = await supabase
          .from("subscriptions")
          .select("*")
          .limit(10)
        
        console.log("Basic query result:", { data: basicResult.data, error: basicResult.error })
        
        if (basicResult.error) {
          throw basicResult.error
        }
        
        // If basic query works, try with foreign key
        const result = await supabase
          .from("subscriptions")
          .select(`
            *,
            beneficiaries!subscriptions_child_id_fkey(
              id,
              name,
              username
            )
          `)
          .order("created_at", { ascending: false })
        
        data = result.data
        error = result.error
      } catch (queryError) {
        console.log("Foreign key query failed, using basic query...", queryError)
        
        // Fallback to basic query without foreign key
        const basicResult = await supabase
          .from("subscriptions")
          .select("*")
          .order("created_at", { ascending: false })
        
        data = basicResult.data
        error = basicResult.error
      }

      if (error) {
        console.error("Error fetching subscriptions:", error)
        console.error("Error details:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        })
        toaster.create({
          title: "Error",
          description: `Failed to fetch subscriptions: ${error.message}`,
          type: "error",
          duration: 5000,
        })
        return
      }

      // Transform the data to match our AdminSubscription type
      const transformedData = data?.map(sub => ({
        ...sub,
        child_name: sub.beneficiaries?.name || `Child ID: ${sub.child_id}`,
        child_username: sub.beneficiaries?.username || "unknown",
        user_email: `User ID: ${sub.user_id}`, // We'll get email separately if needed
        formatted_amount: `$${(sub.amount / 100).toFixed(2)}`,
        formatted_created_at: new Date(sub.created_at).toLocaleDateString(),
        formatted_current_period_start: new Date(sub.current_period_start).toLocaleDateString(),
        formatted_current_period_end: new Date(sub.current_period_end).toLocaleDateString(),
      })) || []

      console.log("Fetched subscriptions:", transformedData.length, "items")
      console.log("Sample subscription:", transformedData[0])

      setSubscriptions(transformedData)
    } catch (error) {
      console.error("Error fetching subscriptions:", error)
      toaster.create({
        title: "Error",
        description: "Failed to fetch subscriptions",
        type: "error",
        duration: 3000,
      })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchSubscriptions()
  }, [])

  const handleRefresh = () => {
    fetchSubscriptions()
  }

  const handleCancelSubscription = async (subscriptionId: string, sponsorshipId: string) => {
    if (!confirm("Are you sure you want to cancel this subscription? This action cannot be undone.")) {
      return
    }

    try {
      const response = await fetch("/api/stripe/cancel-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: sponsorshipId }),
      })

      if (!response.ok) {
        throw new Error("Failed to cancel subscription")
      }

      toaster.create({
        title: "Success",
        description: "Subscription cancelled successfully",
        type: "success",
        duration: 3000,
      })

      // Refresh the data
      fetchSubscriptions()
    } catch (error) {
      console.error("Error canceling subscription:", error)
      toaster.create({
        title: "Error",
        description: "Failed to cancel subscription",
        type: "error",
        duration: 3000,
      })
    }
  }


  if (loading) {
    return (
      <AdminPageLayout
        title="Subscriptions Management"
        description="Manage all active and cancelled subscriptions across the platform"
        searchValue={searchValue}
        onSearchChange={setSearchValue}
      >
        <Box className="container mx-auto py-8">
          <div>Loading subscriptions...</div>
        </Box>
      </AdminPageLayout>
    )
  }

  return (
    <AdminPageLayout
      title="Subscriptions Management"
      description="Manage all active and cancelled subscriptions across the platform"
      searchValue={searchValue}
      onSearchChange={setSearchValue}
    >
      <Box className="container mx-auto py-8">
        <Flex justify="space-between" align="center" mb={8}>
          <Box>
            <Heading size="lg" mb={2}>
              Subscriptions Management
            </Heading>
            <Text color="gray.600">
              Manage all active and cancelled subscriptions across the platform
            </Text>
          </Box>
          
          <Flex gap={4} align="center">
            <Badge colorScheme="blue" fontSize="sm" px={3} py={1}>
              {subscriptions.length} Total Subscriptions
            </Badge>
            
            <Button
              onClick={handleRefresh}
              loading={refreshing}
              size="sm"
              variant="outline"
            >
              <MdRefresh className="mr-2" />
              {refreshing ? "Refreshing..." : "Refresh"}
            </Button>
          </Flex>
        </Flex>

        <DataTable
          columns={columns({
            onCancelSubscription: handleCancelSubscription,
          }) as unknown as ColumnDef<unknown, unknown>[]}
          data={subscriptions}
          controls="bottom"
          tableHeight="h-[70vh]"
        />
      </Box>
    </AdminPageLayout>
  )
}

export default AdminSubscriptionsPage
