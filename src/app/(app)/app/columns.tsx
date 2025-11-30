import { ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { LuArrowUpDown } from "react-icons/lu"
import { MdCancelPresentation } from "react-icons/md"
import { useState } from "react"
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogCloseTrigger,
} from "@/components/ui/dialog"
import { Spinner, Text, Flex, Box } from "@chakra-ui/react"

// Cancel Subscription Button Component with Modal
const CancelSubscriptionButton: React.FC<{ subscription: Subscription }> = ({
  subscription,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleCancelClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsModalOpen(true)
  }

  const handleConfirmCancel = async () => {
    const subscriptionId = subscription.sponsorship_id || subscription.id
    
    if (!subscriptionId) {
      setIsModalOpen(false)
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch("/api/stripe/cancel-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Failed to cancel subscription")
      }

      // Success - refresh the page
      window.location.reload()
    } catch (error) {
      console.error("Error canceling subscription:", error)
      setIsLoading(false)
      setIsModalOpen(false)
      alert(`Error canceling subscription: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  return (
    <>
      <Button onClick={handleCancelClick} size="sm">
        <MdCancelPresentation className="mr-2" />
        Cancel
      </Button>

      <DialogRoot
        open={isModalOpen}
        onOpenChange={(details) => {
          if (!details.open && !isLoading) {
            setIsModalOpen(false)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <Text className="text-lg font-semibold">Cancel Subscription</Text>
            <DialogCloseTrigger disabled={isLoading}>
              <Box className="text-xl cursor-pointer hover:bg-gray-100 rounded-full w-6 h-6 flex items-center justify-center">
                ×
              </Box>
            </DialogCloseTrigger>
          </DialogHeader>
          <DialogBody>
            {isLoading ? (
              <Flex direction="column" align="center" gap={4} py={6}>
                <Spinner size="lg" color="#0654C6" />
                <Text>Cancelling subscription...</Text>
                <Text fontSize="sm" color="gray.500" textAlign="center">
                  Please wait while we process your cancellation request.
                </Text>
              </Flex>
            ) : (
              <Flex direction="column" gap={4}>
                <Text>
                  Are you sure you want to cancel your sponsorship for{" "}
                  <strong>{subscription.child?.name || "this child"}</strong>?
                </Text>
                <Text fontSize="sm" color="gray.600">
                  This action cannot be undone. Your recurring payment of{" "}
                  <strong>${(subscription.amount / 100).toFixed(2)}</strong> will stop,
                  and you'll no longer be supporting this child.
                </Text>
                <Flex gap={3} mt={4}>
                  <Button
                    variant="outline"
                    onClick={() => setIsModalOpen(false)}
                    disabled={isLoading}
                    className="flex-1"
                  >
                    Keep Sponsorship
                  </Button>
                  <Button
                    onClick={handleConfirmCancel}
                    disabled={isLoading}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                  >
                    Yes, Cancel
                  </Button>
                </Flex>
              </Flex>
            )}
          </DialogBody>
        </DialogContent>
      </DialogRoot>
    </>
  )
}

export type Subscription = {
  id: string
  beneficiary_id: string
  status: string
  amount: number
  interval: string
  current_period_start: string
  current_period_end: string
  sponsorship_id: string
  child: {
    name: string
  }
}

export const columns: ColumnDef<Subscription>[] = [
  {
    accessorKey: "child.name",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Child Name
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const child = row.original.child
      return <div>{child?.name || "N/A"}</div>
    },
  },
  {
    accessorKey: "amount",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Amount
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const amount = row.getValue("amount") as number
      return <div>${(amount / 100).toFixed(2)}</div>
    },
  },
  {
    accessorKey: "interval",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Interval
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const interval = row.getValue("interval") as string
      return <div className="capitalize">{interval}</div>
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Status
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const status = row.getValue("status") as string
      return <div className="capitalize">{status}</div>
    },
  },
  {
    accessorKey: "current_period_end",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Next Payment
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const date = row.getValue("current_period_end") as string
      return <div>{new Date(date).toLocaleDateString()}</div>
    },
  },
  {
    id: "actions",
    meta: { excludeFromClick: true },
    header: "Actions",
    cell: ({ row }) => {
      const subscription = row.original
      return subscription.status !== "cancelled" ? (
        <CancelSubscriptionButton subscription={subscription} />
      ) : null
    },
  },
]