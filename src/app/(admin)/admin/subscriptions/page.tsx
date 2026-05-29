"use client"

import { useEffect, useState } from "react"
import { DataTable } from "@/components/admin-ui/Tables/data-table"
import { columns, type AdminSubscription } from "@/app/(admin)/admin/subscriptions/columns"
import { createClient } from "@/utils/supabase/client"
import { Box } from "@chakra-ui/react"
import { ColumnDef } from "@tanstack/react-table"
import AdminPageLayout from "@/components/admin-ui/AdminPageLayout"
import { toaster } from "@/components/ui/toaster"
import { LogoLoader } from "@/components/common/LogoLoader"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { RawSubscription } from "@/types/admin.types"
import { formatMoney } from "@/utils/currency"

const AdminSubscriptionsPage = () => {
  const [subscriptions, setSubscriptions] = useState<AdminSubscription[]>([])
  const [loading, setLoading] = useState(true)
  const [supabase] = useState(() => createClient())

  const transformSubscription = (sub: RawSubscription): AdminSubscription => {
    const canonicalAmount = formatMoney(sub.amount, "USD")
    const chargedAmount =
      sub.charged_amount && sub.charged_currency
        ? formatMoney(sub.charged_amount, sub.charged_currency)
        : null
    return {
      ...sub,
      child_name:
        sub.beneficiaries?.name ||
        (sub.beneficiary_id
          ? `Beneficiary ID: ${sub.beneficiary_id}`
          : "Unknown Beneficiary"),
      child_username: sub.beneficiaries?.username || "unknown",
      user_email: `User ID: ${sub.user_id}`,
      formatted_amount:
        chargedAmount && sub.charged_currency !== "USD"
          ? `${canonicalAmount} (${chargedAmount} charged)`
          : canonicalAmount,
      formatted_created_at: new Date(sub.created_at).toLocaleDateString(),
      formatted_current_period_start: new Date(sub.current_period_start).toLocaleDateString(),
      formatted_current_period_end: new Date(sub.current_period_end).toLocaleDateString(),
    }
  }

  useEffect(() => {
    let channel: RealtimeChannel | null = null
    let mounted = true

    const initialize = async () => {
      try {
        const { data, error } = await supabase
          .from("subscriptions")
          .select(`
            *,
            beneficiaries(id, name, username)
          `)
          .order("created_at", { ascending: false })

        if (error) throw error

        if (mounted) {
          const transformedData = data?.map(transformSubscription) || []
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
                // Cast the newRecord to our RawSubscription type
                const subscriptionRecord = newRecord as RawSubscription

                // Fetch beneficiary data for the new subscription (only if we
                // have a beneficiary_id — partnership rows and other future
                // beneficiary-less subscriptions skip the lookup).
                let beneficiaryData: RawSubscription["beneficiaries"] = null
                if (subscriptionRecord.beneficiary_id) {
                  const { data } = await supabase
                    .from('beneficiaries')
                    .select('id, name, username')
                    .eq('id', subscriptionRecord.beneficiary_id)
                    .single()
                  beneficiaryData = data
                }

                const fullRecord = { ...subscriptionRecord, beneficiaries: beneficiaryData }
                const transformed = transformSubscription(fullRecord)

                setSubscriptions(prev => [transformed, ...prev])
              } else if (eventType === 'UPDATE' && newRecord) {
                // Cast the newRecord to our RawSubscription type
                const subscriptionRecord = newRecord as RawSubscription

                let beneficiaryData: RawSubscription["beneficiaries"] = null
                if (subscriptionRecord.beneficiary_id) {
                  const { data } = await supabase
                    .from('beneficiaries')
                    .select('id, name, username')
                    .eq('id', subscriptionRecord.beneficiary_id)
                    .single()
                  beneficiaryData = data
                }

                const fullRecord = { ...subscriptionRecord, beneficiaries: beneficiaryData }
                const transformed = transformSubscription(fullRecord)

                setSubscriptions(prev =>
                  prev.map(sub => sub.id === transformed.id ? transformed : sub)
                )
              } else if (eventType === 'DELETE' && oldRecord) {
                const subscriptionRecord = oldRecord as RawSubscription
                setSubscriptions(prev => prev.filter(sub => sub.id !== subscriptionRecord.id))
              }
            }
          )
          .subscribe()

      } catch (error: unknown) {
        console.error("❌ Error initializing subscriptions:", error)
        if (mounted) {
          const errorMessage = error instanceof Error ? error.message : "Failed to fetch subscriptions"
          toaster.create({
            title: "Error",
            description: errorMessage,
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

  const handleCancelSubscription = async (subscriptionId: string) => {
    if (!confirm("Are you sure you want to cancel this subscription? This action cannot be undone.")) {
      return
    }

    try {
      const response = await fetch("/api/stripe/cancel-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId }),
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
          <LogoLoader size="lg" minHeight="60vh" />
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
