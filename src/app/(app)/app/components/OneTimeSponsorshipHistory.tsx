"use client"

import { Badge, Box, Button, Flex, Heading, Text } from "@chakra-ui/react"

import type { SponsorOneTimeHistoryItem } from "@/lib/sponsorships/sponsorAccountHistory"
import { presentSponsorHistoryMoney } from "@/lib/sponsorships/sponsorHistoryPresentation"

function sponsorshipLabel(item: SponsorOneTimeHistoryItem): string {
  if (item.subjectKind === "standard") {
    return item.beneficiaryName ?? "Child sponsorship"
  }
  if (item.subjectKind === "blind") return "Blind sponsorship"
  return item.partnershipProject
    ? `${item.partnershipProject[0].toUpperCase()}${item.partnershipProject.slice(1)} partnership`
    : "Creator Share partnership"
}

function financialStatusLabel(
  status: SponsorOneTimeHistoryItem["financialStatus"],
): string {
  switch (status) {
    case "partially_refunded":
      return "Partially refunded"
    case "refunded":
      return "Refunded"
    case "partially_provider_reversed":
      return "Partially reversed by provider"
    case "provider_reversed":
      return "Reversed by provider"
    case "funds_withheld":
      return "Funds withheld"
    default:
      return "Paid"
  }
}

function financialStatusColor(
  status: SponsorOneTimeHistoryItem["financialStatus"],
): string {
  if (status === "paid") return "green"
  if (status === "funds_withheld") return "orange"
  if (status.includes("provider_reversed")) return "red"
  return "purple"
}

export function OneTimeSponsorshipHistory({
  items,
  nextCursor,
  loadingMore,
  error,
  onLoadMore,
}: {
  items: SponsorOneTimeHistoryItem[]
  nextCursor: string | null
  loadingMore: boolean
  error: string | null
  onLoadMore: () => void
}) {
  if (items.length === 0 && error === null) return null

  return (
    <Box mt={10}>
      <Heading size="md" mb={1}>
        One time sponsorship history
      </Heading>
      <Text color="gray.600" mb={4}>
        Successful one time sponsorships made with your verified account email.
      </Text>
      {error && (
        <Text color="red.600" mb={4} role="alert">
          {error}
        </Text>
      )}
      <Flex direction="column" gap={3}>
        {items.map((item) => {
          const money = presentSponsorHistoryMoney(item)
          return (
            <Box
              key={item.sponsorshipIntentId}
              borderWidth="1px"
              borderColor="gray.200"
              borderRadius="lg"
              bg="white"
              px={5}
              py={4}
            >
              <Flex
                align={{ base: "flex-start", md: "center" }}
                justify="space-between"
                direction={{ base: "column", md: "row" }}
                gap={3}
              >
                <Box>
                  <Text fontWeight="semibold">{sponsorshipLabel(item)}</Text>
                  <Text fontSize="sm" color="gray.600">
                    {new Date(item.paidAt).toLocaleDateString()} via{" "}
                    {item.provider === "PAYPAL" ? "PayPal" : "Stripe"}
                  </Text>
                </Box>
                <Flex align="center" gap={3}>
                  <Box textAlign={{ base: "left", md: "right" }}>
                    <Text fontWeight="semibold">
                      {money.primaryAmount}
                    </Text>
                    {money.normalizedNetAmount && (
                      <Text fontSize="xs" color="gray.500">
                        {money.normalizedNetAmount}
                      </Text>
                    )}
                    {money.originalAmount && (
                      <Text fontSize="xs" color="gray.500">
                        {money.originalAmount}
                      </Text>
                    )}
                  </Box>
                  <Badge
                    colorPalette={financialStatusColor(item.financialStatus)}
                  >
                    {financialStatusLabel(item.financialStatus)}
                  </Badge>
                </Flex>
              </Flex>
            </Box>
          )
        })}
      </Flex>
      {nextCursor && (
        <Button
          mt={4}
          variant="outline"
          loading={loadingMore}
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          Load more
        </Button>
      )}
    </Box>
  )
}
