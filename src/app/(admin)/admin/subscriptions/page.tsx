"use client"

import { useEffect, useState } from "react"
import { DataTable } from "@/components/admin-ui/Tables/data-table"
import { columns, type AdminSubscription } from "@/app/(admin)/admin/subscriptions/columns"
import { createClient } from "@/utils/supabase/client"
import { Box } from "@chakra-ui/react"
import { ColumnDef } from "@tanstack/react-table"
import AdminPageLayout from "@/components/admin-ui/AdminPageLayout"
import { toaster } from "@/components/ui/toaster"
import type { RealtimeChannel } from "@supabase/supabase-js"

const AdminSubscriptionsPage = () => {
  const [subscriptions, setSubscriptions] = useState<AdminSubscription[]>([])
  const [loading, setLoading] = useState(true)
  const [supabase] = useState(() => createClient())

  const transformSubscription = (sub: any): AdminSubscription => ({
    ...sub,
    child_name: sub.beneficiaries?.name || `Child ID: ${sub.child_id}`,
    child_username: sub.beneficiaries?.username || "unknown",
    user_email: `User ID: ${sub.user_id}`,
    formatted_amount: `$${(sub.amount / 100).toFixed(2)}`,
    formatted_created_at: new Date(sub.created_at).toLocaleDateString(),
    formatted_current_period_start: new Date(sub.current_period_start).toLocaleDateString(),
    formatted_current_period_end: new Date(sub.current_period_end).toLocaleDateString(),
  })

  useEffect(() => {
    let channel: RealtimeChannel | null = null
    let mounted = true

    const initialize = async () => {
      try {
        console.log("🔄 Initializing subscriptions...")
        
        // Load initial subscriptions
        const { data, error } = await supabase
          .from("subscriptions")
          .select(`
            *,
            beneficiaries(id, name, username)
          `)
          .order("created_at", { ascending: false })

        console.log("📊 Subscription query result:", { data, error })

        if (error) throw error

        if (mounted) {
          const transformedData = data?.map(transformSubscription) || []
          console.log("✅ Setting subscriptions:", transformedData.length, "items")
          setSubscriptions(transformedData)
          setLoading(false)
        }

        // Subscribe to real-time changes
        channel = supabase
          .channel('subscriptions_changes')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'subscriptions',
            },
            async (payload) => {
              if (!mounted) return

              const { eventType, new: newRecord, old: oldRecord } = payload

              if (eventType === 'INSERT' && newRecord) {
                // Fetch beneficiary data for the new subscription
                const { data: beneficiaryData } = await supabase
                  .from('beneficiaries')
                  .select('id, name, username')
                  .eq('id', newRecord.child_id)
                  .single()

                const fullRecord = { ...newRecord, beneficiaries: beneficiaryData }
                const transformed = transformSubscription(fullRecord)

                setSubscriptions(prev => [transformed, ...prev])
              } else if (eventType === 'UPDATE' && newRecord) {
                // Fetch beneficiary data for the updated subscription
                const { data: beneficiaryData } = await supabase
                  .from('beneficiaries')
                  .select('id, name, username')
                  .eq('id', newRecord.child_id)
                  .single()

                const fullRecord = { ...newRecord, beneficiaries: beneficiaryData }
                const transformed = transformSubscription(fullRecord)

                setSubscriptions(prev =>
                  prev.map(sub => sub.id === transformed.id ? transformed : sub)
                )
              } else if (eventType === 'DELETE' && oldRecord) {
                setSubscriptions(prev => prev.filter(sub => sub.id !== oldRecord.id))
              }
            }
          )
          .subscribe()

      } catch (error: any) {
        console.error("❌ Error initializing subscriptions:", error)
        if (mounted) {
          toaster.create({
            title: "Error",
            description: error.message || "Failed to fetch subscriptions",
            type: "error",
            duration: 3000,
          })
          setLoading(false)
        }
      }
    }

    initialize()

    return () => {
      mounted = false
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
  }, [supabase])

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

      // Real-time will automatically update the table
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


  return (
    <AdminPageLayout
      title="Subscriptions Management"
      description="Manage all active and cancelled subscriptions across the platform"
      searchValue=""
      onSearchChange={() => {}}
      showResults={true}
      breadcrumb={[
        {
          label: "Subscriptions",
          href: "/admin/subscriptions"
        }
      ]}
    >
      <Box className="container mx-auto py-8">
        {loading ? (
          <div className="text-center py-8">
            <div className="text-lg">Loading subscriptions...</div>
            <div className="text-sm text-gray-500 mt-2">Found {subscriptions.length} subscriptions</div>
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-lg">No subscriptions found</div>
            <div className="text-sm text-gray-500 mt-2">Check your database connection</div>
          </div>
        ) : (
          <DataTable
            columns={columns({
              onCancelSubscription: handleCancelSubscription,
            }) as unknown as ColumnDef<unknown, unknown>[]}
            data={subscriptions}
            controls="bottom"
            tableHeight="h-[70vh]"
          />
        )}
      </Box>
    </AdminPageLayout>
  )
}

export default AdminSubscriptionsPage
