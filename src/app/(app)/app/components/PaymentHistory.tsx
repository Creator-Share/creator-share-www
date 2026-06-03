"use client"

import { useState, useCallback } from "react"
import { Box, Text, Flex, Separator, Skeleton, Table } from "@chakra-ui/react"
import { createClient } from "@/utils/supabase/client"

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

export const PaymentHistory: React.FC<PaymentHistoryProps> = ({ userId }) => {
  const [txns, setTxns] = useState<TransactionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const fetchTxns = useCallback(async () => {
    if (txns.length > 0) return
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
      setTxns(data as unknown as TransactionRow[])
    }
    setLoading(false)
  }, [userId, txns.length])

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
            setExpanded((v) => !v)
            if (!expanded && txns.length === 0) fetchTxns()
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
            {expanded ? "Collapse ▲" : "View all ▼"}
          </Text>
        </Flex>

        {expanded && (
          <Box bg="white" borderRadius="xl" boxShadow="sm" overflow="hidden">
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
              <Box overflowX="auto">
                <Table.Root size="sm">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>Date</Table.ColumnHeader>
                      <Table.ColumnHeader>Amount</Table.ColumnHeader>
                      <Table.ColumnHeader>Description</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {txns.map((t) => (
                      <Table.Row key={t.id}>
                        <Table.Cell fontSize="xs">{fmtDate(t.created_at)}</Table.Cell>
                        <Table.Cell fontSize="xs" fontWeight="600" color="#059669">
                          {cents(t.credit)}
                        </Table.Cell>
                        <Table.Cell fontSize="xs" color="gray.600">
                          {t.description || "Sponsorship payment"}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Box>
            )}
          </Box>
        )}
      </Box>
    </>
  )
}
