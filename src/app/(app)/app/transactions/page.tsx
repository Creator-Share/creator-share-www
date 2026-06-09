"use client"

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import {
  Box, Heading, Text, Flex, Badge, Skeleton, HStack, Button,
} from "@chakra-ui/react"
import { Tooltip } from "@/components/ui/tooltip"
import { createClient } from "@/utils/supabase/client"
import { useAuthStore } from "@/store/authStore"
import { redactEmail } from "@/utils/privacy"
import { formatMoney, formatUsdCents } from "@/utils/currency"

// ─── Types ───────────────────────────────────────────────────────────────────

interface TransactionRow {
  id: string
  created_at: string
  credit: number | null
  charged_amount: number | null
  charged_currency: string | null
  conversion_rate: number | null
  subscription_type: string | null
  payment_region: "us" | "uk" | null
  description: string | null
  customer_email: string | null
  customer_name: string | null
  beneficiary_id: string | null
}

type FilterType = "all" | "subscription" | "one_time"
type FilterRegion = "all" | "us" | "uk" | "other"

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HEADER_GRADIENT = "linear-gradient(135deg, #dbeafe 0%, #e0f2fe 50%, #f0f9ff 100%)"
function txnCacheKey(userId: string) {
  return `transactions_cache_${userId}`
}

function readTxnCache(userId: string): TransactionRow[] | null {
  try { const raw = sessionStorage.getItem(txnCacheKey(userId)); return raw ? JSON.parse(raw) : null } catch { return null }
}
function writeTxnCache(userId: string, txns: TransactionRow[]) {
  try { sessionStorage.setItem(txnCacheKey(userId), JSON.stringify(txns)) } catch { /* noop */ }
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function regionInfo(region: "us" | "uk" | null): { label: string; emoji: string } {
  if (region === "us") return { label: "US", emoji: "🇺🇸" }
  if (region === "uk") return { label: "UK", emoji: "🇬🇧" }
  return { label: "Other", emoji: "💳" }
}

function typeLabel(t: string | null): string {
  if (t === "one_time") return "One-time"
  if (t === "subscription") return "Subscription"
  return "Payment"
}

// ─── Page ────────────────────────────────────────────────────────────────────

const TransactionPage = () => {
  const { user } = useAuthStore()
  const supabaseRef = useRef(createClient())

  const [txns, setTxns] = useState<TransactionRow[]>(() => user ? readTxnCache(user.id) ?? [] : [])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  // Filters synced with URL params
  const searchParams = useSearchParams()
  const router = useRouter()

  const filterType = (searchParams.get("type") as FilterType) || "all"
  const filterRegion = (searchParams.get("region") as FilterRegion) || "all"

  const setFilterType = (value: FilterType) => {
    const p = new URLSearchParams(searchParams.toString())
    if (value === "all") p.delete("type")
    else p.set("type", value)
    router.replace(`/app/transactions?${p.toString()}`, { scroll: false })
  }

  const setFilterRegion = (value: FilterRegion) => {
    const p = new URLSearchParams(searchParams.toString())
    if (value === "all") p.delete("region")
    else p.set("region", value)
    router.replace(`/app/transactions?${p.toString()}`, { scroll: false })
  }

  // ── Data fetch ──
  const fetchTxns = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setFetchError(null)
    const supabase = supabaseRef.current

    const { data, error } = await supabase
      .from("transaction_ledger")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })

    if (error) {
      console.error(error)
      setFetchError("Couldn't load your transactions")
    } else if (data) {
      const rows = data as unknown as TransactionRow[]
      setTxns(rows)
      writeTxnCache(user.id, rows)
    }
    setLoading(false)
  }, [user])

  useEffect(() => { fetchTxns() }, [fetchTxns])

  // ── Filtered data ──
  const filtered = useMemo(() => {
    let result = txns
    if (filterType !== "all") {
      result = result.filter(t => t.subscription_type === filterType)
    }
    if (filterRegion === "other") {
      result = result.filter(t => t.payment_region == null)
    } else if (filterRegion !== "all") {
      result = result.filter(t => t.payment_region === filterRegion)
    }
    return result
  }, [txns, filterType, filterRegion])

  // Stats
  const stats = useMemo(() => {
    let totalCents = 0
    let subCount = 0
    let oneTimeCount = 0
    let otherCount = 0
    for (const t of txns) {
      totalCents += t.credit ?? 0
      if (t.subscription_type === "one_time") oneTimeCount++
      else if (t.subscription_type === "subscription") subCount++
      else otherCount++
    }
    return { totalDonated: totalCents / 100, subCount, oneTimeCount, otherCount, total: txns.length }
  }, [txns])

  // ── Filter button component ──
  const FilterPill = <T extends string>({
    value, current, label, setter,
  }: {
    value: T; current: T; label: string; setter: (v: T) => void
  }) => (
    <Box
      as="button"
      onClick={() => setter(value)}
      px={4}
      py={1.5}
      borderRadius="full"
      fontSize="sm"
      fontWeight={value === current ? "600" : "400"}
      bg={value === current ? "#2b7ff9" : "gray.100"}
      color={value === current ? "white" : "gray.600"}
      _hover={{ bg: value === current ? "#1a6fe0" : "gray.200" }}
      transition="all 0.15s"
    >
      {label}
    </Box>
  )

  // ── Loading ──
  if (loading) {
    return (
      <Box className="container mx-auto py-8" maxW="1200px" px={4}>
        <Skeleton height="28px" width="220px" mb={2} borderRadius="lg" />
        <Skeleton height="14px" width="160px" mb={8} borderRadius="lg" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} height="56px" mb={2} borderRadius="xl" />
        ))}
      </Box>
    )
  }

  return (
    <Box className="container mx-auto py-8" maxW="1200px" px={4}>
      {/* ── Header ── */}
      <Box mb={6} bg={HEADER_GRADIENT} borderRadius="2xl" p={{ base: 5, md: 7 }}>
        <Heading size="lg" mb={1} color="gray.800">Transactions</Heading>
        <Text color="gray.500" fontSize="sm">
          {stats.total > 0
            ? `${stats.total} payment${stats.total === 1 ? "" : "s"} · ${formatUsdCents(stats.totalDonated * 100)} total`
            : "Your payment history"}
        </Text>

        <HStack gap={4} mt={5} wrap="wrap">
          <Box bg="white" px={5} py={3.5} borderRadius="xl" boxShadow="sm" minW="120px">
            <Text fontSize="24px" fontWeight="bold" color="#2b7ff9">{stats.subCount}</Text>
            <Text fontSize="xs" color="gray.500" mt={0.5}>Subscriptions</Text>
          </Box>
          <Box bg="white" px={5} py={3.5} borderRadius="xl" boxShadow="sm" minW="120px">
            <Text fontSize="24px" fontWeight="bold" color="#059669">{stats.oneTimeCount}</Text>
            <Text fontSize="xs" color="gray.500" mt={0.5}>One-time</Text>
          </Box>
          <Tooltip
            content={
              <Box fontSize="xs" lineHeight="1.7">
                <Text>💰 {formatUsdCents(stats.totalDonated * 100)} — total across all transactions</Text>
              </Box>
            }
            contentProps={{ maxW: "300px" }}
          >
            <Box bg="white" px={5} py={3.5} borderRadius="xl" boxShadow="sm" minW="140px" cursor="help">
              <Text fontSize="24px" fontWeight="bold" color="gray.700">
                {formatUsdCents(stats.totalDonated * 100)}
              </Text>
              <Text fontSize="xs" color="gray.500" mt={0.5}>Total contributed</Text>
            </Box>
          </Tooltip>
        </HStack>
      </Box>

      {/* ── Filters ── */}
      <Flex gap={3} mb={5} wrap="wrap" align="center">
        <Text fontSize="sm" fontWeight="600" color="gray.500" mr={1}>Type:</Text>
        <FilterPill value="all" current={filterType} label="All" setter={setFilterType} />
        <FilterPill value="subscription" current={filterType} label="📅 Subscriptions" setter={setFilterType} />
        <FilterPill value="one_time" current={filterType} label="⚡ One-time" setter={setFilterType} />

        <Text fontSize="sm" fontWeight="600" color="gray.500" ml={2} mr={1}>Region:</Text>
        <FilterPill value="all" current={filterRegion} label="All" setter={setFilterRegion} />
        <FilterPill value="us" current={filterRegion} label="🇺🇸 US" setter={setFilterRegion} />
        <FilterPill value="uk" current={filterRegion} label="🇬🇧 UK" setter={setFilterRegion} />
        <FilterPill value="other" current={filterRegion} label="💳 Other" setter={setFilterRegion} />
      </Flex>

      {/* ── Error ── */}
      {fetchError && (
        <Box mb={5} p={4} bg="red.50" border="1px" borderColor="red.200" borderRadius="xl">
          <Text fontSize="sm" color="red.700">{fetchError}</Text>
          <Button size="xs" mt={2} variant="outline" colorScheme="red" borderRadius="10px" onClick={fetchTxns}>Try again</Button>
        </Box>
      )}

      {/* ── Empty state ── */}
      {filtered.length === 0 && !fetchError && (
        <Box textAlign="center" py={16}>
          <Text fontSize="4xl" mb={4}>{txns.length === 0 ? "💳" : "🔍"}</Text>
          <Heading size="md" mb={2}>
            {txns.length === 0 ? "No transactions yet" : "No transactions match your filters"}
          </Heading>
          <Text color="gray.500" maxW="400px" mx="auto" lineHeight="1.6">
            {txns.length === 0
              ? "Your payment history will appear here once you sponsor a child."
              : "Try changing your filter to see more results."}
          </Text>
        </Box>
      )}

      {/* ── Transaction list ── */}
      {filtered.length > 0 && (
        <Box>
          {/* Column headers — hidden on small screens */}
          <Flex
            px={4} py={2} mb={2}
            color="gray.400" fontSize="xs" fontWeight="600" textTransform="uppercase"
            letterSpacing="0.05em"
            display={{ base: "none", md: "flex" }}
          >
            <Box flex="1.2">Date</Box>
            <Box flex="1">Amount</Box>
            <Box flex="0.8">Type</Box>
            <Box flex="0.7">Region</Box>
            <Box flex="1.6">Sponsor</Box>
            <Box flex="2">Description</Box>
          </Flex>

          {filtered.map(t => {
            const isForeign = t.charged_currency != null && t.charged_currency !== "USD"
            const region = regionInfo(t.payment_region)
            const isChargedCurrent =
              t.charged_amount != null &&
              t.charged_currency != null

            return (
              <Flex
                key={t.id}
                px={4} py={3.5}
                bg="white"
                borderRadius="xl"
                boxShadow="sm"
                mb={1.5}
                align="center"
                gap={{ base: 2, md: 0 }}
                _hover={{ boxShadow: "md", transform: "translateY(-1px)" }}
                transition="all 0.15s"
                wrap={{ base: "wrap", md: "nowrap" }}
              >
                {/* Date + Amount row (always visible) */}
                <Box flex="1.2" fontSize="sm" color="gray.600" whiteSpace="nowrap">
                  {fmtDate(t.created_at)}
                </Box>

                {/* Amount — show charged currency primarily, USD as fallback */}
                <Box flex="1">
                  <Text fontSize="sm" fontWeight="600" color={isForeign ? "gray.700" : "#059669"}>
                    {isChargedCurrent
                      ? formatMoney(t.charged_amount, t.charged_currency)
                      : formatUsdCents(t.credit)}
                  </Text>
                  {isForeign && (
                    <Text fontSize="xs" color="gray.400">
                      {formatUsdCents(t.credit)} USD
                    </Text>
                  )}
                </Box>

                {/* Type badge */}
                <Box flex="0.8">
                  <Badge
                    colorPalette={t.subscription_type === "one_time" ? "orange" : "blue"}
                    fontSize="xs"
                    borderRadius="full"
                    px={2.5}
                    py={0.5}
                    textTransform="none"
                    fontWeight="500"
                  >
                    {typeLabel(t.subscription_type)}
                  </Badge>
                </Box>

                {/* Region */}
                <Box flex="0.7">
                  <Badge
                    variant="subtle"
                    colorPalette={t.payment_region === "us" ? "blue" : t.payment_region === "uk" ? "purple" : "gray"}
                    fontSize="xs"
                    borderRadius="full"
                    px={2.5}
                    py={0.5}
                    textTransform="none"
                    fontWeight="500"
                  >
                    {region.emoji} {region.label}
                  </Badge>
                </Box>

                {/* Sponsor info (obfuscated) — hidden on mobile */}
                <Box flex="1.6" minW={0} display={{ base: "none", md: "block" }}>
                  {t.customer_name && (
                    <Text fontSize="sm" fontWeight="500" color="gray.700"
                      css={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.customer_name}
                    </Text>
                  )}
                  {t.customer_email && (
                    <Text fontSize="xs" color="gray.400">
                      {redactEmail(t.customer_email)}
                    </Text>
                  )}
                  {!t.customer_name && !t.customer_email && (
                    <Text fontSize="xs" color="gray.300">—</Text>
                  )}
                </Box>

                {/* Description — shown as full-width second row on mobile */}
                <Box w={{ base: "full", md: "auto" }} flex={{ base: "none", md: "2" }} order={{ base: 1, md: 0 }} mt={{ base: 0.5, md: 0 }} minW={0}>
                  <Text fontSize="xs" color="gray.500"
                    css={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "280px" }}>
                    {t.description || "—"}
                  </Text>
                </Box>
              </Flex>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

export default function TransactionPageWrapper() {
  return (
    <Suspense fallback={
      <Box className="container mx-auto py-8" maxW="1200px" px={4}>
        <Skeleton height="28px" width="220px" mb={2} borderRadius="lg" />
        <Skeleton height="14px" width="160px" mb={8} borderRadius="lg" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} height="56px" mb={2} borderRadius="xl" />
        ))}
      </Box>
    }>
      <TransactionPage />
    </Suspense>
  )
}
