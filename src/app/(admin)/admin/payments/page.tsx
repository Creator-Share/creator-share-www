"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { DataTable } from "@/components/admin-ui/Tables/data-table"
import { columns, type AdminPayment } from "@/app/(admin)/admin/payments/columns"
import { createClient } from "@/utils/supabase/client"
import { Box, Button, Flex, Text } from "@chakra-ui/react"
import AdminPageLayout from "@/components/admin-ui/AdminPageLayout"
import { ColumnDef } from "@tanstack/react-table"
import { toaster } from "@/components/ui/toaster"
import { LogoLoader } from "@/components/common/LogoLoader"
import { formatMoney, formatUsdCents } from "@/utils/currency"
import { redactEmail } from "@/utils/privacy"

// ─── Raw row from Supabase ──────────────────────────────────────────────────

interface RawTransaction {
  id: string
  created_at: string
  credit: number | null
  charged_amount: number | null
  charged_currency: string | null
  conversion_rate: number
  description: string | null
  customer_email: string | null
  customer_name: string | null
  beneficiary_id: string | null
  subscription_type: "subscription" | "one_time" | null
  payment_region: "us" | "uk" | null
  user_id: string | null
  beneficiaries?: { id: string; name: string } | null
}

// ─── Color constants ─────────────────────────────────────────────────────────

const ADMIN_BLUE = "#2b7ff9"
const ADMIN_BLUE_HOVER = "#1a6fe0"

// ─── Helpers ────────────────────────────────────────────────────────────────

type FilterType = "all" | "subscription" | "one_time"
type FilterRegion = "all" | "us" | "uk"

interface FilterPillProps<T extends string> {
  value: T
  current: T
  label: string
  setter: (v: T) => void
}

function FilterPill<T extends string>({
  value,
  current,
  label,
  setter,
}: FilterPillProps<T>) {
  return (
    <Box
      as="button"
      onClick={() => setter(value)}
      px={4}
      py={1.5}
      borderRadius="full"
      fontSize="sm"
      fontWeight={value === current ? "600" : "400"}
      bg={value === current ? ADMIN_BLUE : "gray.100"}
      color={value === current ? "white" : "gray.600"}
      _hover={{ bg: value === current ? ADMIN_BLUE_HOVER : "gray.200" }}
      transition="all 0.15s"
    >
      {label}
    </Box>
  )
}

// ─── Transform ──────────────────────────────────────────────────────────────

const transformPayment = (tx: RawTransaction): AdminPayment => {
  const isForeign =
    tx.charged_amount != null &&
    tx.charged_currency != null &&
    tx.charged_currency !== "USD"

  const formattedAmount = isForeign
    ? `${formatUsdCents(tx.credit)} (${formatMoney(tx.charged_amount, tx.charged_currency)})`
    : formatUsdCents(tx.credit)

  const obfuscatedEmail = tx.customer_email
    ? redactEmail(tx.customer_email)
    : "—"

  return {
    ...tx,
    formatted_amount: formattedAmount,
    formatted_created_at: new Date(tx.created_at).toLocaleDateString(
      "en-GB",
      {
        day: "numeric",
        month: "short",
        year: "numeric",
      },
    ),
    child_name: tx.beneficiaries?.name ?? "—",
    customer_obfuscated: obfuscatedEmail,
  }
}

function extractErrorMessage(err: unknown, fallback = "Failed to load payments"): string {
  return err instanceof Error ? err.message : fallback
}

// ─── Component ──────────────────────────────────────────────────────────────

const AdminPaymentsPage = () => {
  const [payments, setPayments] = useState<AdminPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [filterType, setFilterType] = useState<FilterType>("all")
  const [filterRegion, setFilterRegion] = useState<FilterRegion>("all")
  const supabase = useRef(createClient()).current

  // ── Data fetch (no realtime) ──

  useEffect(() => {
    let mounted = true

    setError(null)
    setLoading(true)

    const fetchPayments = async () => {
      try {
        const { data, error } = await supabase
          .from("transaction_ledger")
          .select(
            `
            *,
            beneficiaries(id, name)
          `,
          )
          .order("created_at", { ascending: false })
          .limit(500)

        if (error) throw error

        if (mounted) {
          const transformed = (data ?? []).map((tx) =>
            transformPayment(tx as unknown as RawTransaction),
          )
          setPayments(transformed)
          setLoading(false)
        }
      } catch (error: unknown) {
        console.error("❌ Error loading payments:", error)
        if (mounted) {
          const message = extractErrorMessage(error)
          setError(message)
          toaster.create({
            title: "Error",
            description: message,
            type: "error",
            duration: 3000,
          })
          setLoading(false)
        }
      }
    }

    fetchPayments()

    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, retryKey])

  // ── Real-time inserts (separate effect — no async gap, so no race) ──

  useEffect(() => {
    const channel = supabase
      .channel("payments_changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "transaction_ledger",
        },
        async (payload) => {
          const newTx = payload.new as RawTransaction

          // Fetch beneficiary name if applicable
          let beneficiaryData: RawTransaction["beneficiaries"] = null
          if (newTx.beneficiary_id) {
            try {
              const { data: ben } = await supabase
                .from("beneficiaries")
                .select("id, name")
                .eq("id", newTx.beneficiary_id)
                .single()
              beneficiaryData = ben
            } catch (e) {
              console.error("Failed to fetch beneficiary for realtime insert:", e)
            }
          }

          const full = { ...newTx, beneficiaries: beneficiaryData }
          setPayments((prev) => [transformPayment(full), ...prev])
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase])

  // ── Filters ──

  const filtered = useMemo(() => {
    let result = payments
    if (filterType !== "all") {
      result = result.filter((p) => p.subscription_type === filterType)
    }
    if (filterRegion !== "all") {
      result = result.filter((p) => p.payment_region === filterRegion)
    }
    return result
  }, [payments, filterType, filterRegion])

  // ── Stats (from filtered view) ──

  const stats = useMemo(() => {
    let totalCents = 0
    let subCount = 0
    let oneTimeCount = 0
    for (const p of filtered) {
      totalCents += p.credit ?? 0
      if (p.subscription_type === "one_time") oneTimeCount++
      else if (p.subscription_type === "subscription") subCount++
    }
    const hasFilters = filterType !== "all" || filterRegion !== "all"
    return {
      totalFormatted: formatUsdCents(totalCents),
      totalCount: filtered.length,
      totalAll: payments.length,
      subCount,
      oneTimeCount,
      hasFilters,
    }
  }, [filtered, payments, filterType, filterRegion])

  return (
    <AdminPageLayout
      title="Payments"
      description="All received payments — subscription renewals and one-time donations"
      searchValue=""
      onSearchChange={() => {}}
      showResults={true}
      breadcrumb={[{ label: "Payments", href: "/admin/payments" }]}
    >
      <Box className="container mx-auto py-8">
        {/* Summary cards */}
        <Flex gap={4} mb={6} wrap="wrap">
          <Box
            bg="white"
            px={5}
            py={3.5}
            borderRadius="xl"
            boxShadow="sm"
            minW="140px"
          >
            <Text fontSize="24px" fontWeight="bold" color="gray.700">
              {stats.totalFormatted}
            </Text>
            <Text fontSize="xs" color="gray.500" mt={0.5}>
              Total received
              {stats.hasFilters && (
                <Text as="span" color="gray.400">
                  {" "}
                  · {stats.totalCount} of {stats.totalAll} payments
                </Text>
              )}
            </Text>
          </Box>
          <Box
            bg="white"
            px={5}
            py={3.5}
            borderRadius="xl"
            boxShadow="sm"
            minW="120px"
          >
            <Text fontSize="24px" fontWeight="bold" color="#2b7ff9">
              {stats.subCount}
            </Text>
            <Text fontSize="xs" color="gray.500" mt={0.5}>
              Subscription payments
            </Text>
          </Box>
          <Box
            bg="white"
            px={5}
            py={3.5}
            borderRadius="xl"
            boxShadow="sm"
            minW="120px"
          >
            <Text fontSize="24px" fontWeight="bold" color="#059669">
              {stats.oneTimeCount}
            </Text>
            <Text fontSize="xs" color="gray.500" mt={0.5}>
              One-time payments
            </Text>
          </Box>
        </Flex>

        {/* Filters */}
        <Flex gap={3} mb={5} wrap="wrap" align="center">
          <Text
            fontSize="sm"
            fontWeight="600"
            color="gray.500"
            mr={1}
          >
            Type:
          </Text>
          <FilterPill
            value="all"
            current={filterType}
            label="All"
            setter={setFilterType}
          />
          <FilterPill
            value="subscription"
            current={filterType}
            label="Subscriptions"
            setter={setFilterType}
          />
          <FilterPill
            value="one_time"
            current={filterType}
            label="One-time"
            setter={setFilterType}
          />

          <Text
            fontSize="sm"
            fontWeight="600"
            color="gray.500"
            ml={2}
            mr={1}
          >
            Region:
          </Text>
          <FilterPill
            value="all"
            current={filterRegion}
            label="All"
            setter={setFilterRegion}
          />
          <FilterPill
            value="us"
            current={filterRegion}
            label="US"
            setter={setFilterRegion}
          />
          <FilterPill
            value="uk"
            current={filterRegion}
            label="UK"
            setter={setFilterRegion}
          />
        </Flex>

        {/* Table / states */}
        {error ? (
          <Box textAlign="center" py={16}>
              <Box fontSize="lg" fontWeight="semibold" mb={2}>
              Failed to load payments
            </Box>
            <Text
              color="gray.500"
              maxW="400px"
              mx="auto"
              lineHeight="1.6"
              fontSize="sm"
            >
              {error}
            </Text>
            <Button
              mt={4}
              bg={ADMIN_BLUE}
              color="white"
              _hover={{ bg: ADMIN_BLUE_HOVER }}
              onClick={() => setRetryKey((k) => k + 1)}
            >
              Retry
            </Button>
          </Box>
        ) : loading ? (
          <LogoLoader size="lg" minHeight="60vh" />
        ) : filtered.length === 0 ? (
          <Box textAlign="center" py={16}>
              <Box fontSize="lg" fontWeight="semibold" mb={2}>
              {payments.length === 0
                ? "No payments yet"
                : "No payments match your filters"}
            </Box>
            <Text
              color="gray.500"
              maxW="400px"
              mx="auto"
              lineHeight="1.6"
            >
              {payments.length === 0
                ? "Payments received through Stripe or PayPal will appear here."
                : "Try changing your filter to see more results."}
            </Text>
          </Box>
        ) : (
          <DataTable
            columns={columns() as unknown as ColumnDef<unknown, unknown>[]}
            data={filtered}
            controls="bottom"
            tableHeight="h-[70vh]"
          />
        )}
      </Box>
    </AdminPageLayout>
  )
}

export default AdminPaymentsPage