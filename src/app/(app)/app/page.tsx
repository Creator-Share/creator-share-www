"use client"
import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import {
  Box, Heading, Text, Button, SimpleGrid, Skeleton, Flex, VStack, Spinner,
} from "@chakra-ui/react"
import { Tooltip } from "@/components/ui/tooltip"
import { createClient } from "@/utils/supabase/client"
import { useAuthStore } from "@/store/authStore"
import { toaster } from "@/components/ui/toaster"
import Link from "next/link"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"
import { BeneficiarySelectionModal } from "./components/BeneficiarySelectionModal"
import { PaymentHistory } from "./components/PaymentHistory"
import { DashboardErrorBoundary } from "./components/DashboardErrorBoundary"
import SponsoredBeneficiaryCard from "./components/SponsoredBeneficiaryCard"

const HEADER_GRADIENT = "linear-gradient(135deg, #dbeafe 0%, #e0f2fe 50%, #f0f9ff 100%)"
const BLIND_BANNER_GRADIENT = "linear-gradient(135deg, #fef9c3 0%, #fef3c7 100%)"

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChildFields {
  id: string; name: string; username: string; birth_date: string | null
  gender: string | null; country: string | null; biography: string | null
  beneficiary_type: string | null; metadata: Record<string, unknown> | null
}

interface SubscriptionRow {
  id: string; beneficiary_id: string | null; user_id: string; status: string
  amount: number; interval: string; current_period_start: string
  current_period_end: string; stripe_subscription_id: string | null
  created_at: string; canceled_at: string | null; child: ChildFields | null
}

interface BeneficiaryProfile {
  id: string; name: string; username: string; birth_date: string | null
  gender: string | null; country: string | null; biography: string | null
  beneficiary_type: string | null; metadata: Record<string, unknown> | null
}

interface Sponsorship { sub: SubscriptionRow; ben: BeneficiaryProfile }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function elapsedLabel(start: string, end?: string): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()
  const days = Math.round(ms / (24 * 60 * 60 * 1000))
  if (days < 30) return days <= 1 ? "a day" : `${days} days`
  const months = Math.round(days / 30)
  if (months < 2) return "a month"
  return `${months} months`
}

function computeStats(active: Sponsorship[], past: Sponsorship[]) {
  let totalCents = 0; let earliest: string | null = null
  for (const { sub } of [...active, ...past]) {
    const months = sub.canceled_at
      ? Math.max(1, Math.round((new Date(sub.canceled_at).getTime() - new Date(sub.created_at).getTime()) / (30 * 24 * 60 * 60 * 1000)))
      : Math.max(1, Math.round((Date.now() - new Date(sub.created_at).getTime()) / (30 * 24 * 60 * 60 * 1000)))
    totalCents += sub.amount * months
    if (!earliest || sub.created_at < earliest) earliest = sub.created_at
  }
  const label = earliest ? elapsedLabel(earliest) : ""
  return { totalDonated: totalCents / 100, durationLabel: label }
}

function cents(n: number | null | undefined) {
  if (n == null) return "$0"
  return `$${(n / 100).toFixed(n % 100 === 0 ? 0 : 2)}`
}

function cacheKey(userId?: string) {
  return userId ? `dashboard_cache_${userId}` : "dashboard_cache"
}

function readCache(userId?: string) {
  try {
    const raw = sessionStorage.getItem(cacheKey(userId))
    return raw ? JSON.parse(raw) as { active: Sponsorship[]; past: Sponsorship[]; blind: SubscriptionRow[] } | null : null
  } catch { return null }
}
function writeCache(userId: string, active: Sponsorship[], past: Sponsorship[], blind: SubscriptionRow[]) {
  try { sessionStorage.setItem(cacheKey(userId), JSON.stringify({ active, past, blind })) } catch { /* noop */ }
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

const UserDashboard = () => {
  const { user } = useAuthStore()
  const supabaseRef = useRef(createClient())

  const [active, setActive] = useState<Sponsorship[]>([])
  const [past, setPast] = useState<Sponsorship[]>([])
  const [blind, setBlind] = useState<SubscriptionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actualTotalCents, setActualTotalCents] = useState<number | null>(null)

  // Modal + collapse state
  const [modalOpen, setModalOpen] = useState(false)
  const [modalSubId, setModalSubId] = useState<string | null>(null)
  const [pastExpanded, setPastExpanded] = useState(false)

  // ── Data fetch ───────────────────────────────────────────────────────────
  const fetchData = useCallback(async (isBackground = false) => {
    if (!user) return
    if (isBackground) setRefreshing(true)
    setFetchError(null)
    const supabase = supabaseRef.current

    const { data: subs, error } = await supabase
      .from("subscriptions")
      .select("*, child:beneficiaries(id, name, username, birth_date, gender, country, biography, beneficiary_type, metadata)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })

    if (error) {
      console.error(error)
      // Only show error banner if we have nothing cached
      setFetchError("Couldn't load your sponsorships")
      setLoading(false); setRefreshing(false); return
    }

    const rows = (subs ?? []) as unknown as SubscriptionRow[]
    const act: SubscriptionRow[] = []; const bln: SubscriptionRow[] = []; const pst: SubscriptionRow[] = []
    for (const r of rows) {
      if (r.status === "complete" && r.beneficiary_id && r.child) act.push(r)
      else if (r.status === "complete" && !r.beneficiary_id) bln.push(r)
      else if (r.status === "cancelled" && r.beneficiary_id && r.child) pst.push(r)
    }

    const ids = [...act, ...pst].map(s => s.beneficiary_id).filter(Boolean) as string[]
    let benMap = new Map<string, BeneficiaryProfile>()
    if (ids.length > 0) {
      const { data: bens } = await supabase.from("beneficiaries").select("*").in("id", ids)
      if (bens) benMap = new Map(bens.map(b => [b.id, b as unknown as BeneficiaryProfile]))
    }

    const toSps = (list: SubscriptionRow[]) =>
      list.map(s => ({ sub: s, ben: benMap.get(s.beneficiary_id!)! })).filter(x => x.ben)

    // Also fetch actual transaction total
    const { data: txns } = await supabase
      .from("transaction_ledger")
      .select("credit")
      .eq("user_id", user.id)
    let actualTotal = 0
    if (txns) {
      for (const t of txns as { credit: number | null }[]) {
        actualTotal += t.credit ?? 0
      }
    }
    setActualTotalCents(actualTotal)

    const na = toSps(act); const np = toSps(pst); const nb = bln
    setActive(na); setPast(np); setBlind(nb); writeCache(user.id, na, np, nb)
    setLoading(false); setRefreshing(false)
  }, [user])

  // Hydrate from cache on mount & when user identity resolves, so the correct
  // user-scoped key is always used (even on SPA navigations where auth is instant).
  useEffect(() => {
    const cache = readCache(user?.id)
    if (cache) {
      setActive(cache.active)
      setPast(cache.past)
      setBlind(cache.blind)
      setLoading(false)
    }
  }, [user])

  useEffect(() => { fetchData(true) }, [fetchData])

  // ── Real-time ──
  useEffect(() => {
    if (!user) return
    const supabase = supabaseRef.current
    const ch = supabase
      .channel("dashboard_subscriptions")
      .on<SubscriptionRow>("postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${user.id}` },
        (p: RealtimePostgresChangesPayload<SubscriptionRow>) => {
          if (p.eventType === "INSERT") {
            if (p.new.status === "complete" && p.new.beneficiary_id) fetchData(true)
            else if (p.new.status === "complete" && !p.new.beneficiary_id)
              setBlind(prev => prev.some(x => x.id === p.new.id) ? prev : [p.new, ...prev])
          } else if (p.eventType === "UPDATE") {
            if (p.new.status === "cancelled") {
              setActive(prev => prev.filter(x => x.sub.id !== p.new.id))
              setBlind(prev => prev.filter(x => x.id !== p.new.id))
              setPast(pst => {
                const m = activeRef.current.find(x => x.sub.id === p.new.id)
                if (!m) return pst
                return [{ ...m, sub: { ...m.sub, status: "cancelled", canceled_at: p.new.canceled_at } }, ...pst]
              })
            } else if (p.new.status === "complete" && p.new.beneficiary_id) fetchData(true)
          } else if (p.eventType === "DELETE") {
            setActive(prev => prev.filter(x => x.sub.id !== p.old.id))
            setBlind(prev => prev.filter(x => x.id !== p.old.id))
            setPast(prev => prev.filter(x => x.sub.id !== p.old.id))
          }
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user, fetchData])

  // ── Optimistic cancel with retry ──
  const activeRef = useRef(active)
  activeRef.current = active

  const [cancellingId, setCancellingId] = useState<string | null>(null)

  // Empty deps is intentional: activeRef (ref) stays current via render-body
  // assignment, and state setters are stable. The retry self-reference works
  // because closures capture the binding, not the value.
  const handleCancel = useCallback(async (subId: string) => {
    const originalIndex = activeRef.current.findIndex(x => x.sub.id === subId)
    if (originalIndex === -1) return
    const m = activeRef.current[originalIndex]
    setCancellingId(subId)

    // Optimistic remove from active (don't move to past until API confirms)
    setActive(prev => prev.filter(x => x.sub.id !== subId))

    try {
      const res = await fetch("/api/stripe/cancel-subscription", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: m.sub.stripe_subscription_id || m.sub.id }),
      })
      if (!res.ok) { const b = await res.json(); throw new Error(b.error || "Failed") }
      // API succeeded — safely move to past
      const opt: Sponsorship = { sub: { ...m.sub, status: "cancelled" as const, canceled_at: new Date().toISOString() }, ben: m.ben }
      setPast(prev => [opt, ...prev])
      setCancellingId(null)
      toaster.create({ title: "Sponsorship ended", description: "You can always start a new one later.", type: "success", duration: 4000 })
    } catch (err) {
      // Rollback — restore at original position so the card doesn't jump
      setActive(prev => {
        const at = Math.min(originalIndex, prev.length)
        return [...prev.slice(0, at), m, ...prev.slice(at)]
      })
      setCancellingId(null)
      toaster.create({
        title: "Couldn't process cancellation",
        description: err instanceof Error ? err.message : "Something went wrong",
        type: "error", duration: 10000,
        action: { label: "Retry", onClick: () => handleCancel(subId) },
      })
    }
  }, [])

  const stats = useMemo(() => computeStats(active, past), [active, past])
  const showEmpty = !loading && active.length === 0 && past.length === 0 && blind.length === 0

  // ── Loading ──
  if (loading) {
    return (
      <Box className="container mx-auto py-8" maxW="1200px" px={4}>
        <Skeleton height="28px" width="280px" mb={2} borderRadius="lg" />
        <Skeleton height="14px" width="200px" mb={8} borderRadius="lg" />
        <SimpleGrid columns={{ base: 2, md: 3, xl: 4 }} gap={4}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Box key={i} borderRadius="20px" overflow="hidden" className="animate-pulse">
              <Box bg="gray.100" height="200px" />
              <Box p={4}><Box bg="gray.100" height="16px" w="60%" mb={2} borderRadius="md" />
              <Box bg="gray.100" height="12px" w="40%" mb={3} borderRadius="md" />
              <Box bg="gray.100" height="12px" w="80%" borderRadius="md" /></Box>
            </Box>
          ))}
        </SimpleGrid>
      </Box>
    )
  }

  // ── Empty ──
  if (showEmpty) {
    return (
      <Box className="container mx-auto py-20 text-center" maxW="1200px" px={4}>
        <Text fontSize="4xl" mb={4}>🌍</Text>
        <Heading size="lg" mb={2}>Ready to change a life?</Heading>
        <Text color="gray.500" mb={8} maxW="480px" mx="auto" lineHeight="1.6">
          Your sponsorship gives a child access to education, nutrition, healthcare, and
          the chance to build a brighter future. Every contribution makes a real difference.
        </Text>
        <Button bg="#2b7ff9" color="white" borderRadius="16px" px={8} py={6} fontSize="md"
          _hover={{ bg: "#1a6fe0", transform: "translateY(-1px)" }} transition="all 0.15s"
          onClick={() => window.location.href = "/"}>
          Browse children to sponsor
        </Button>
      </Box>
    )
  }

  return (
    <Box className="container mx-auto py-8" maxW="1200px" px={4}>
      {/* ── Warm header ── */}
      <Box mb={8} bg={HEADER_GRADIENT} borderRadius="2xl" p={{ base: 5, md: 7 }}>
        <Flex align="flex-start" justify="space-between" wrap="wrap" gap={4}>
          <Box>
            <Heading size="lg" mb={1} color="gray.800">Your impact</Heading>
            <Text color="gray.500" fontSize="sm">
              {stats.durationLabel
                ? `Making a difference for ${stats.durationLabel}`
                : "Every bit of support matters"}
            </Text>
            {refreshing && <Flex align="center" gap={1.5} mt={1}><Spinner size="xs" color="#2b7ff9" /><Text fontSize="xs" color="#2b7ff9">Updating…</Text></Flex>}
          </Box>
          <Link href="/app/transactions" style={{ textDecoration: "none" }}>
            <Button
              size="sm"
              variant="outline"
              borderRadius="12px"
              borderColor="#2b7ff9"
              color="#2b7ff9"
              _hover={{ bg: "#2b7ff9", color: "white" }}
              fontSize="xs"
              px={3}
            >
              View all transactions →
            </Button>
          </Link>
        </Flex>

        <Flex gap={4} mt={5} wrap="wrap">
          <Box bg="white" px={5} py={3.5} borderRadius="xl" boxShadow="sm" minW="130px">
            <Text fontSize="28px" fontWeight="bold" color="#2b7ff9">{active.length}</Text>
            <Text fontSize="xs" color="gray.500" mt={0.5}>{active.length === 1 ? "Child sponsored" : "Children sponsored"}</Text>
          </Box>
          <Tooltip
            content={
              <Box fontSize="xs" lineHeight="1.7">
                <Text>💰 {cents(stats.totalDonated * 100)} — commitment from active & past subscriptions</Text>
                <Text>💵 {cents(actualTotalCents ?? 0)} — actually charged</Text>
              </Box>
            }
            contentProps={{
              bg: "gray.800",
              color: "white",
              borderRadius: "lg",
              p: 3,
            }}
            showArrow
          >
            <Box bg="white" px={5} py={3.5} borderRadius="xl" boxShadow="sm" minW="130px" cursor="help">
              <Text fontSize="28px" fontWeight="bold" color="#059669">{stats.totalDonated < 1000 ? `$${stats.totalDonated.toFixed(0)}` : `$${(stats.totalDonated / 1000).toFixed(1)}k`}</Text>
              <Text fontSize="xs" color="gray.500" mt={0.5}>Committed</Text>
            </Box>
          </Tooltip>
          {past.length > 0 && (
            <Box bg="white" px={5} py={3.5} borderRadius="xl" boxShadow="sm" minW="130px">
              <Text fontSize="28px" fontWeight="bold" color="gray.400">{past.length}</Text>
              <Text fontSize="xs" color="gray.500" mt={0.5}>Past sponsorships</Text>
            </Box>
          )}
        </Flex>
      </Box>

      {/* ── Error banner ── */}
      {fetchError && (
        <Box mb={6} p={4} bg="red.50" border="1px" borderColor="red.200" borderRadius="xl">
          <Text fontSize="sm" color="red.700">{fetchError}</Text>
          <Button size="xs" mt={2} variant="outline" colorScheme="red" borderRadius="10px" onClick={() => fetchData(true)}>Try again</Button>
        </Box>
      )}

      {/* ── Blind banner ── */}
      {blind.length > 0 && (
        <Box mb={6} p={5} bg={BLIND_BANNER_GRADIENT} border="1px" borderColor="#fde68a" borderRadius="xl">
          <Text fontWeight="600" mb={1}>📋 Waiting to be matched</Text>
          <Text fontSize="sm" color="gray.600" mb={3}>
            You have {blind.length} sponsorship{blind.length > 1 ? "s" : ""} ready to go —
            choose which child you&apos;d like to support!
          </Text>
          {blind.length === 1 ? (
            <Button size="sm" borderRadius="12px" bg="#2b7ff9" color="white" _hover={{ bg: "#1a6fe0" }}
              onClick={() => { setModalSubId(blind[0].id); setModalOpen(true) }}>
              Choose a child
            </Button>
          ) : (
            <Flex gap={2} wrap="wrap">
              {blind.map((b, i) => (
                <Button key={b.id} size="sm" borderRadius="12px" bg="#2b7ff9" color="white" _hover={{ bg: "#1a6fe0" }}
                  onClick={() => { setModalSubId(b.id); setModalOpen(true) }}>
                  Choose a child #{i + 1}
                </Button>
              ))}
            </Flex>
          )}
        </Box>
      )}

      {/* ── Active ── */}
      {active.length > 0 && (
        <Box mb={8}>
          <Heading size="md" mb={1}>Sponsoring now</Heading>
          <Text fontSize="sm" color="gray.500" mb={4}>The children you&apos;re currently supporting</Text>
          <SimpleGrid columns={{ base: 2, md: 3, xl: 4 }} gap={{ base: "0.75rem", md: "1rem" }}>
            {active.map(({ sub, ben }) => (
              <SponsoredBeneficiaryCard
                key={sub.id}
                beneficiary={ben}
                subscription={{
                  id: sub.id, amount: sub.amount, interval: sub.interval, status: sub.status,
                  current_period_end: sub.current_period_end, created_at: sub.created_at,
                  stripe_subscription_id: sub.stripe_subscription_id,
                }}
                onViewProfile={() => window.location.href = `/sponsorships/${ben.username}`}
                onCancel={() => handleCancel(sub.id)}
                isCancelling={cancellingId === sub.id}
              />
            ))}
          </SimpleGrid>
        </Box>
      )}

      {/* ── Past ── */}
      {past.length > 0 && (
        <Box mb={8}>
          <Flex as="button" w="full" align="center" justify="space-between"
            onClick={() => setPastExpanded(v => !v)} mb={pastExpanded ? 4 : 0} className="group">
            <Box textAlign="left">
              <Heading size="md">Your journey so far</Heading>
              <Text fontSize="sm" color="gray.500">Children you&apos;ve supported in the past</Text>
            </Box>
            <Text fontSize="sm" color="#2b7ff9" fontWeight="600" className="group-hover:underline">
              {pastExpanded ? "Collapse ▲" : `Show all (${past.length}) ▼`}
            </Text>
          </Flex>

          {pastExpanded && (
            <VStack gap={2} align="stretch">
              {past.map(({ sub, ben }) => {
                const dur = sub.created_at && sub.canceled_at ? elapsedLabel(sub.created_at, sub.canceled_at) : null
                return (
                  <Link key={sub.id} href={`/sponsorships/${ben.username}`}
                    style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                    <Box display="flex" gap={3} p={4} bg="white" borderRadius="xl" boxShadow="sm"
                      alignItems="center" cursor="pointer"
                      _hover={{ boxShadow: "md", transform: "translateY(-1px)", transition: "all 0.15s" }}>
                      <Box w="44px" h="44px" borderRadius="full" bg="gray.50" flexShrink={0} overflow="hidden" display="flex" alignItems="center" justifyContent="center" fontSize="lg" opacity={0.7}>
                        💛
                      </Box>
                      <Box flex={1} minW={0}>
                        <Text fontWeight="600" fontSize="sm"
                          css={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ben.name}</Text>
                        <Flex gap={2} mt={0.5} align="center" wrap="wrap">
                          {dur && <Text fontSize="xs" color="gray.500">Supported for {dur}</Text>}
                          <Text fontSize="xs" color="gray.400">·</Text>
                          <Text fontSize="xs" color="gray.400">Ended {fmtDate(sub.canceled_at!)}</Text>
                        </Flex>
                      </Box>
                      <Text fontSize="sm" fontWeight="600" color="gray.500" whiteSpace="nowrap">
                        {cents(sub.amount)}{sub.interval === "year" ? "/yr" : "/mo"}
                      </Text>
                    </Box>
                  </Link>
                )
              })}
            </VStack>
          )}
        </Box>
      )}

      {/* ── Payment history ── */}
      {user && <PaymentHistory userId={user.id} />}

      {/* ── Modal ── */}
      {modalSubId && (
        <BeneficiarySelectionModal
          isOpen={modalOpen}
          onClose={() => { setModalOpen(false); setModalSubId(null) }}
          subscriptionId={modalSubId}
          onSuccess={() => { setModalOpen(false); setModalSubId(null); fetchData(true) }}
        />
      )}
    </Box>
  )
}

export default function DashboardPage() {
  return (
    <DashboardErrorBoundary>
      <UserDashboard />
    </DashboardErrorBoundary>
  )
}
