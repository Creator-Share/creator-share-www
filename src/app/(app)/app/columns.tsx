import { ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { LuArrowUpDown } from "react-icons/lu"
import { MdCancelPresentation } from "react-icons/md"
import { useRef, useState } from "react"
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogCloseTrigger,
} from "@/components/ui/dialog"
import { Spinner, Text, Flex } from "@chakra-ui/react"
import { presentSubscriptionSubject } from "@/lib/sponsorships/subscriptionPresentation"
import {
  parseSubscriptionCancellationClientResult,
  subscriptionCancellationNotice,
} from "@/lib/sponsorships/cancellation/subscriptionCancellationClient"
import type { SponsorRecurringSponsorship } from "@/lib/sponsorships/sponsorRecurringSponsorships"
import {
  isRecentVerificationRequiredResponse,
  requestFreshSponsorAuthentication,
  sponsorReauthenticationMessage,
} from "@/lib/sponsorships/management/sponsorReauthenticationClient"
import { ManagePaymentMethodButton } from "./components/ManagePaymentMethodButton"

// Cancel Subscription Button Component with Modal
const CancelSubscriptionButton: React.FC<{ subscription: Subscription }> = ({
  subscription,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const actionInFlight = useRef(false)
  const subject = presentSubscriptionSubject({
    subjectKind: subscription.subject_kind,
    partnershipProject: subscription.partnership_project,
    beneficiaryId: subscription.beneficiary_id,
  })

  const handleCancelClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsModalOpen(true)
  }

  const handleConfirmCancel = async () => {
    if (actionInFlight.current) return
    const subscriptionId = subscription.id

    if (!subscriptionId) {
      setIsModalOpen(false)
      return
    }

    actionInFlight.current = true
    setIsLoading(true)

    try {
      const response = await fetch("/api/sponsorships/subscriptions/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId }),
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
      })

      const body = (await response.json().catch(() => null)) as unknown
      if (isRecentVerificationRequiredResponse(response.status, body)) {
        const requestAccepted = await requestFreshSponsorAuthentication()
        setIsModalOpen(false)
        alert(
          sponsorReauthenticationMessage("cancel-sponsorship", requestAccepted),
        )
        return
      }

      const result = parseSubscriptionCancellationClientResult(body)

      if (!response.ok || !result) {
        throw new Error("cancellation-unavailable")
      }

      const notice = subscriptionCancellationNotice(result.status)
      alert(`${notice.title}\n\n${notice.description}`)
      setIsModalOpen(false)
      if (result.status === "cancelled") window.location.reload()
    } catch {
      setIsModalOpen(false)
      alert(
        "We could not submit the cancellation request. Please try again shortly.",
      )
    } finally {
      actionInFlight.current = false
      setIsLoading(false)
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
            <DialogCloseTrigger disabled={isLoading} />
          </DialogHeader>
          <DialogBody>
            {isLoading ? (
              <Flex direction="column" align="center" gap={4} py={6}>
                <Spinner size="lg" color="#2b7ff9" />
                <Text>Cancelling subscription...</Text>
                <Text fontSize="sm" color="gray.500" textAlign="center">
                  Please wait while we process your cancellation request.
                </Text>
              </Flex>
            ) : (
              <Flex direction="column" gap={4}>
                <Text>
                  Are you sure you want to cancel your{" "}
                  {subject.subjectKind === "partnership"
                    ? "partnership"
                    : "sponsorship"}
                  {subject.subjectKind === "partnership" ? (
                    <>
                      {" "}
                      for the <strong>{subject.title}</strong>?
                    </>
                  ) : subscription.beneficiary_id ? (
                    <>
                      {" "}
                      for{" "}
                      <strong>
                        {subscription.child?.name || "this beneficiary"}
                      </strong>
                      ?
                    </>
                  ) : (
                    <>
                      ? This sponsorship hasn't been matched to a beneficiary
                      yet.
                    </>
                  )}
                </Text>
                <Text fontSize="sm" color="gray.600">
                  Once provider processing begins, this request cannot be
                  withdrawn. Future billing of{" "}
                  <strong>${(subscription.amount / 100).toFixed(2)}</strong>{" "}
                  stops only after the payment provider confirms cancellation.
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

export type Subscription = SponsorRecurringSponsorship & {
  onChooseChild?: (subscriptionId: string) => void
}

export const columns: ColumnDef<Subscription>[] = [
  {
    accessorKey: "child.name",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Name
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const subscription = row.original
      const child = subscription.child
      const subject = presentSubscriptionSubject({
        subjectKind: subscription.subject_kind,
        partnershipProject: subscription.partnership_project,
        beneficiaryId: subscription.beneficiary_id,
      })

      if (subject.subjectKind === "partnership") {
        return (
          <div className="flex items-center gap-3">
            <div>
              <div className="font-medium text-gray-700">{subject.title}</div>
              <div className="text-xs text-gray-500">{subject.subtitle}</div>
            </div>
          </div>
        )
      }

      if (subject.subjectKind === "blind") {
        return (
          <div className="flex items-center gap-3">
            <div>
              <div className="font-medium text-gray-700">Awaiting Match</div>
              <div className="text-xs text-gray-500">Blind Sponsorship</div>
            </div>
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
              Pending
            </span>
            {subject.canChooseChild && subscription.onChooseChild && (
              <Button
                size="xs"
                colorScheme="blue"
                onClick={(e) => {
                  e.stopPropagation()
                  subscription.onChooseChild?.(subscription.id)
                }}
              >
                Choose
              </Button>
            )}
          </div>
        )
      }

      return (
        <div>
          {child?.name ? (
            <a
              href={`/sponsorships/${child.username || child.name.toLowerCase().replace(/\s+/g, "-")}`}
              className="text-blue-600 hover:text-blue-800 hover:underline"
            >
              {child.name}
            </a>
          ) : (
            "N/A"
          )}
        </div>
      )
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
      const date = row.getValue("current_period_end") as string | null
      return <div>{date ? new Date(date).toLocaleDateString() : "N/A"}</div>
    },
  },
  {
    id: "actions",
    meta: { excludeFromClick: true },
    header: "Actions",
    cell: ({ row }) => {
      const subscription = row.original
      return subscription.status !== "cancelled" ? (
        <Flex gap={2} wrap="wrap">
          <ManagePaymentMethodButton subscriptionId={subscription.id} />
          <CancelSubscriptionButton subscription={subscription} />
        </Flex>
      ) : null
    },
  },
]
