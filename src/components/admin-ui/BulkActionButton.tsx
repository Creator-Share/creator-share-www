"use client"

import { Button } from "@/components/ui/button"
import { toaster } from "@/components/ui/toaster"

interface BulkActionButtonProps {
  label: string
  count: number
  action: () => void
  disabled?: boolean
  className?: string
}

export function BulkActionButton({ 
  label, 
  count, 
  action, 
  disabled = false,
  className
}: BulkActionButtonProps) {
  const handleClick = () => {
    if (count === 0) {
      toaster.create({
        title: "No Selection",
        description: "No items selected.",
        duration: 3000,
      })
      return
    }
    action()
  }

  return (
    <Button
      onClick={handleClick}
      size="sm"
      disabled={disabled}
      className={className}
    >
      {label} ({count})
    </Button>
  )
} 