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
import { presentSubscriptionSubject } from "@/lib/sponsorships/subscriptionPresentation"
import {
  parseSubscriptionCancellationClientResult,
  subscriptionCancellationNotice,
} from "@/lib/sponsorships/cancellation/subscriptionCancellationClient"

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
    const subject = presentSubscriptionSubject({
      subjectKind: sub.subject_kind,
      partnershipProject: sub.partnership_project,
      beneficiaryId: sub.beneficiary_id,
    })
    return {
      ...sub,
      child_name:
        subject.subjectKind === "partnership"
          ? subject.title
          : sub.beneficiaries?.name ||
            (sub.beneficiary_id
              ? `Beneficiary ID: ${sub.beneficiary_id}`
              : subject.title),
      child_username:
        subject.subjectKind === "partnership"
          ? ""
          : sub.beneficiaries?.username || "unknown",
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
    if (!confirm("Submit this cancellation request? Once provider processing begins, the request cannot be withdrawn.")) {
      return
    }

    const enteredReason = window.prompt(
      "Enter a specific internal reason for this cancellation. Do not include email addresses, phone numbers, or payment provider references.",
    )
    if (enteredReason === null) return

    const reason = enteredReason.replace(/\s+/g, " ").trim()
    if (reason.length < 10 || reason.length > 500) {
      toaster.create({
        title: "Cancellation reason required",
        description: "Enter a specific reason between 10 and 500 characters.",
        type: "error",
        duration: 5000,
      })
      return
    }

    try {
      const response = await fetch("/api/sponsorships/subscriptions/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId, reason }),
      })
      const body = (await response.json().catch(() => null)) as unknown
      const result = parseSubscriptionCancellationClientResult(body)

      if (!result) {
        throw new Error("Failed to cancel subscription")
      }

      const notice = subscriptionCancellationNotice(result.status)
      toaster.create({
        title: notice.title,
        description: notice.description,
        type: notice.kind,
        duration: 6000,
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
