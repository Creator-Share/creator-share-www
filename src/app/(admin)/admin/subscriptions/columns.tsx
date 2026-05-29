import { ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { LuArrowUpDown } from "react-icons/lu"
import { MdCancelPresentation } from "react-icons/md"
import { Badge } from "@chakra-ui/react"

export type AdminSubscription = {
  id: string
  beneficiary_id: string | null
  status: string
  amount: number
  charged_amount?: number | null
  charged_currency?: string | null
  conversion_rate?: number | null
  interval: string
  current_period_start: string
  current_period_end: string
  created_at: string
  user_id: string
  sponsorship_method: "STRIPE" | "PAYPAL" | null
  payment_region: "us" | "uk"
  // Transformed fields
  child_name: string
  child_username: string
  user_email: string
  formatted_amount: string
  formatted_created_at: string
  formatted_current_period_start: string
  formatted_current_period_end: string
  // Related data
  child?: {
    id: string
    name: string
    username: string
  }
  user?: {
    id: string
    email: string
  }
}

interface ColumnActions {
  onCancelSubscription: (subscriptionId: string) => void
}

export const columns = (actions: ColumnActions): ColumnDef<AdminSubscription>[] => [
  {
    accessorKey: "child_name",
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
      const childName = row.getValue("child_name") as string
      const childUsername = row.original.child_username
      return (
        <div>
          <div className="font-medium">{childName}</div>
          <div className="text-sm text-gray-500">@{childUsername}</div>
        </div>
      )
    },
  },
  {
    accessorKey: "user_email",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Subscriber
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const userEmail = row.getValue("user_email") as string
      return (
        <div className="text-sm">
          {userEmail}
        </div>
      )
    },
  },
  {
    accessorKey: "formatted_amount",
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
      const amount = row.getValue("formatted_amount") as string
      const interval = row.original.interval
      return (
        <div>
          <div className="font-medium">{amount}</div>
          <div className="text-sm text-gray-500 capitalize">{interval}</div>
        </div>
      )
    },
  },
  {
    accessorKey: "sponsorship_method",
    header: "Method",
    cell: ({ row }) => {
      const method = row.original.sponsorship_method || "STRIPE"
      const colorScheme = method === "PAYPAL" ? "blue" : "purple"
      return (
        <Badge colorScheme={colorScheme} variant="subtle">
          {method}
        </Badge>
      )
    },
  },
  {
    accessorKey: "payment_region",
    header: "Region",
    cell: ({ row }) => {
      const region = (row.original.payment_region || "us").toUpperCase()
      return (
        <Badge colorScheme="gray" variant="subtle">
          {region}
        </Badge>
      )
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
      
      const getStatusBadge = (status: string) => {
        switch (status.toLowerCase()) {
          case 'active':
            return <Badge colorScheme="green" variant="subtle">Active</Badge>
          case 'cancelled':
          case 'canceled':
            return <Badge colorScheme="red" variant="subtle">Cancelled</Badge>
          case 'past_due':
            return <Badge colorScheme="orange" variant="subtle">Past Due</Badge>
          case 'unpaid':
            return <Badge colorScheme="yellow" variant="subtle">Unpaid</Badge>
          case 'incomplete':
            return <Badge colorScheme="gray" variant="subtle">Incomplete</Badge>
          case 'incomplete_expired':
            return <Badge colorScheme="red" variant="subtle">Expired</Badge>
          case 'trialing':
            return <Badge colorScheme="blue" variant="subtle">Trial</Badge>
          case 'paused':
            return <Badge colorScheme="purple" variant="subtle">Paused</Badge>
          default:
            return <Badge colorScheme="gray" variant="subtle">{status}</Badge>
        }
      }
      
      return getStatusBadge(status)
    },
  },
  {
    accessorKey: "formatted_current_period_end",
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
      const nextPayment = row.getValue("formatted_current_period_end") as string
      const currentPeriodStart = row.original.formatted_current_period_start
      return (
        <div>
          <div className="font-medium">{nextPayment}</div>
          <div className="text-sm text-gray-500">Since {currentPeriodStart}</div>
        </div>
      )
    },
  },
  {
    accessorKey: "formatted_created_at",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Created
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const createdAt = row.getValue("formatted_created_at") as string
      return <div className="text-sm">{createdAt}</div>
    },
  },
  {
    id: "actions",
    meta: { excludeFromClick: true },
    header: "Actions",
    cell: ({ row }) => {
      const subscription = row.original
      const isCancelled = subscription.status === 'cancelled' || subscription.status === 'canceled'
      
      return (
        <div className="flex gap-2">
          {!isCancelled ? (
            <Button
              onClick={(e) => {
                e.stopPropagation()
                if (confirm("Are you sure you want to cancel this subscription? This action cannot be undone.")) {
                  actions.onCancelSubscription(subscription.id)
                }
              }}
              size="sm"
              variant="outline"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <MdCancelPresentation className="mr-1 h-4 w-4" />
              Cancel
            </Button>
          ) : (
            <span className="text-sm text-gray-400">No actions</span>
          )}
        </div>
      )
    },
  },
]
