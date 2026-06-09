import { ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { LuArrowUpDown } from "react-icons/lu"
import { Badge } from "@chakra-ui/react"

const SUBSCRIPTION_LABELS: Record<"one_time" | "subscription", { label: string; color: string }> = {
  one_time: { label: "One-time", color: "orange" },
  subscription: { label: "Subscription", color: "blue" },
}

const REGION_LABELS: Record<"us" | "uk", { label: string; color: string }> = {
  us: { label: "US", color: "blue" },
  uk: { label: "UK", color: "purple" },
}

export type AdminPayment = {
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
  // Transformed fields
  formatted_amount: string
  formatted_created_at: string
  child_name: string
  customer_obfuscated: string
}

export const columns = (): ColumnDef<AdminPayment>[] => [
  {
    accessorKey: "created_at",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Date
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const date = row.original.formatted_created_at
      return <div className="text-sm whitespace-nowrap">{date}</div>
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
      return <div className="font-medium">{amount}</div>
    },
  },
  {
    accessorKey: "subscription_type",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Type
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const type = row.original.subscription_type
      const cfg = type ? SUBSCRIPTION_LABELS[type] : null
      return (
        <Badge colorScheme={cfg?.color ?? "gray"} variant="subtle">
          {cfg?.label ?? "—"}
        </Badge>
      )
    },
  },
  {
    accessorKey: "payment_region",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Region
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const region = row.original.payment_region
      const cfg = region ? REGION_LABELS[region] : null
      return (
        <Badge colorScheme={cfg?.color ?? "gray"} variant="subtle">
          {cfg?.label ?? "Other"}
        </Badge>
      )
    },
  },
  {
    accessorKey: "child_name",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Beneficiary
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const name = row.getValue("child_name") as string
      return <div className="text-sm">{name}</div>
    },
  },
  {
    accessorKey: "customer_obfuscated",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Sponsor
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const obfuscated = row.getValue("customer_obfuscated") as string
      const name = row.original.customer_name
      return (
        <div>
          {name && <div className="text-sm font-medium">{name}</div>}
          <div className="text-xs text-gray-400">{obfuscated}</div>
        </div>
      )
    },
  },
  {
    accessorKey: "description",
    header: "Description",
    cell: ({ row }) => {
      const desc = row.getValue("description") as string | null
      return (
        <div className="text-sm text-gray-500 max-w-[240px] truncate" title={desc ?? undefined}>
          {desc || "—"}
        </div>
      )
    },
  },
]
