"use client"

import { useState, useCallback, useRef } from "react"
import { Box, Text, Flex, Separator, Skeleton } from "@chakra-ui/react"
import { createClient } from "@/utils/supabase/client"
import Link from "next/link"

interface TransactionRow {
  id: string
  created_at: string
  credit: number | null
  description: string | null
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function cents(n: number | null | undefined) {
  if (n == null) return "$0"
  return `$${(n / 100).toFixed(n % 100 === 0 ? 0 : 2)}`
}

interface PaymentHistoryProps {
  userId: string
}

function paymentCacheKey(userId: string) {
  return `payment_history_cache_${userId}`
}

function readPaymentCache(userId: string): TransactionRow[] | null {
  try {
    const raw = sessionStorage.getItem(paymentCacheKey(userId))
    return raw ? JSON.parse(raw) as TransactionRow[] : null
  } catch { return null }
}

function writePaymentCache(userId: string, txns: TransactionRow[]) {
  try { sessionStorage.setItem(paymentCacheKey(userId), JSON.stringify(txns)) } catch { /* noop */ }
}

export const PaymentHistory: React.FC<PaymentHistoryProps> = ({ userId }) => {
  const [txns, setTxns] = useState<TransactionRow[]>(() => readPaymentCache(userId) ?? [])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const hasFetched = useRef(false)

  const fetchTxns = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from("transaction_ledger")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20)

    if (error) {
      console.error(error)
    } else if (data) {
      const rows = data as unknown as TransactionRow[]
      setTxns(rows)
      writePaymentCache(userId, rows)
    }
    setLoading(false)
  }, [userId])

  return (
    <>
      <Separator mb={6} />
      <Box mb={8}>
        <Flex
          as="button"
          w="full"
          align="center"
          justify="space-between"
          onClick={() => {
            const next = !expanded
            setExpanded(next)
            if (next && !hasFetched.current) { hasFetched.current = true; fetchTxns() }
          }}
          mb={expanded ? 4 : 0}
          className="group"
        >
          <Box textAlign="left">
            <Text fontWeight="700" fontSize="lg">
              Payment history
            </Text>
            <Text fontSize="sm" color="gray.500">
              Your past contributions and receipts
            </Text>
          </Box>
          <Text fontSize="sm" color="#2b7ff9" fontWeight="600" className="group-hover:underline">
            {expanded ? "Collapse ▲" : hasFetched.current ? `View all (${txns.length}) ▼` : "View all ▼"}
          </Text>
        </Flex>

        {expanded && (
          <Box bg="white" borderRadius="xl" boxShadow="sm" overflow="hidden" pb={3}>
            {loading ? (
              <Box p={6}>
                <Skeleton height="20px" mb={3} borderRadius="md" />
                <Skeleton height="20px" mb={3} borderRadius="md" />
                <Skeleton height="20px" borderRadius="md" />
              </Box>
            ) : txns.length === 0 ? (
              <Text fontSize="sm" color="gray.400" p={6} textAlign="center">
                No payment records yet.
              </Text>
            ) : (
              <Box>
                {txns.map((t) => (
                  <Flex
                    key={t.id}
                    px={4} py={3}
                    bg="white"
                    borderRadius="xl"
                    boxShadow="sm"
                    mb={1.5}
                    align="center"
                    _hover={{ boxShadow: "md", transform: "translateY(-1px)" }}
                    transition="all 0.15s"
                  >
                    <Box flex="1.2" fontSize="sm" color="gray.600" whiteSpace="nowrap">
                      {fmtDate(t.created_at)}
                    </Box>
                    <Box flex="1">
                      <Text fontSize="sm" fontWeight="600" color="#059669">
                        {cents(t.credit)}
                      </Text>
                    </Box>
                    <Box flex="2" minW={0}>
                      <Text fontSize="xs" color="gray.500"
                        css={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.description || "Sponsorship payment"}
                      </Text>
                    </Box>
                  </Flex>
                ))}
              </Box>
            )}
            {expanded && txns.length > 0 && (
              <Flex justify="center" pt={2}>
                <Link href="/app/transactions" style={{ textDecoration: "none" }}>
                  <Text
                    fontSize="xs"
                    color="#2b7ff9"
                    fontWeight="500"
                    _hover={{ textDecoration: "underline" }}
                    cursor="pointer"
                  >
                    See full breakdown with filters →
                  </Text>
                </Link>
              </Flex>
            )}
          </Box>
        )}
      </Box>
    </>
  )
}
