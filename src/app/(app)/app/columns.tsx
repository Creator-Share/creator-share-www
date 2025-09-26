import { ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { LuArrowUpDown } from "react-icons/lu"
import { MdCancelPresentation } from "react-icons/md"

export type Subscription = {
  id: string
  child_id: string
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
      return (
        subscription.status !== "cancelled" && (
          <Button
            onClick={(e) => {
              e.stopPropagation()
              if (
                confirm("Are you sure you want to cancel this subscription?")
              ) {
                handleCancelSubscription(subscription.sponsorship_id)
              }
            }}
            size="sm"
          >
            <MdCancelPresentation className="mr-2" />
            Cancel
          </Button>
        )
      )
    },
  },
]

async function handleCancelSubscription(stripeSubscriptionId: string) {
  try {
    const response = await fetch("/api/stripe/cancel-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscriptionId: stripeSubscriptionId }),
    })

    if (!response.ok) throw new Error("Failed to cancel subscription")
    window.location.reload()
  } catch (error) {
    console.error("Error canceling subscription:", error)
  }
}
