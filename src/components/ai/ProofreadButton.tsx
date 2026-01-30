"use client"
import React, { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { toaster } from "@/components/ui/toaster"
import ProofreadComparison from "./ProofreadComparison"
import { HiSparkles } from "react-icons/hi"

interface ProofreadButtonProps {
  text: string
  onAccept: (proofreadText: string) => void
  fieldLabel?: string
  disabled?: boolean
  size?: "xs" | "sm" | "md" | "lg"
  type?: "biography" | "activity"
  onShowComparison?: (showing: boolean) => void
}

const ProofreadButton: React.FC<ProofreadButtonProps> = ({
  text,
  onAccept,
  fieldLabel = "Text",
  disabled = false,
  size = "sm",
  type = "biography",
  onShowComparison
}) => {
  const [isLoading, setIsLoading] = useState(false)
  const [showComparison, setShowComparison] = useState(false)
  const [proofreadText, setProofreadText] = useState("")
  const [originalText, setOriginalText] = useState("")
  const [isFeatureAvailable, setIsFeatureAvailable] = useState<boolean | null>(
    null
  )

  // Check feature availability on mount
  useEffect(() => {
    fetch("/api/ai/config")
      .then((res) => res.json())
      .then((data) => setIsFeatureAvailable(data.available))
      .catch(() => setIsFeatureAvailable(false))
  }, [])

  // Notify parent when comparison visibility changes
  useEffect(() => {
    if (onShowComparison) {
      onShowComparison(showComparison)
    }
  }, [showComparison, onShowComparison])

  const handleProofread = async (e?: React.MouseEvent, additionalInstructions?: string) => {
    // Prevent default behavior and stop propagation
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }

    if (!text || text.trim().length === 0) {
      toaster.create({
        title: "No text to proofread",
        description: `Please enter some ${fieldLabel.toLowerCase()} first.`,
        type: "warning",
        duration: 3000
      })
      return
    }

    setIsLoading(true)
    setOriginalText(text)

    try {
      const requestBody: { text: string; type: string; instructions?: string } = {
        text,
        type
      }
      
      if (additionalInstructions && additionalInstructions.trim()) {
        requestBody.instructions = additionalInstructions.trim()
      }

      const response = await fetch("/api/ai/proofread", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to proofread text")
      }

      setProofreadText(data.proofreadText)
      setShowComparison(true)
    } catch (error) {
      console.error("Proofread error:", error)
      toaster.create({
        title: "Proofreading failed",
        description:
          error instanceof Error
            ? error.message
            : "An error occurred while proofreading. Please try again.",
        type: "error",
        duration: 5000
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleAccept = () => {
    onAccept(proofreadText)
    setShowComparison(false)
    toaster.create({
      title: "Text updated",
      description: "AI suggestions have been applied successfully.",
      type: "success",
      duration: 3000
    })
  }

  const handleReject = () => {
    setShowComparison(false)
    toaster.create({
      title: "Suggestions rejected",
      description: "Original text has been kept.",
      type: "info",
      duration: 3000
    })
  }

  const handleRetry = (additionalInstructions?: string) => {
    handleProofread(undefined, additionalInstructions)
  }

  // Hide component if feature is not available
  if (isFeatureAvailable === false) {
    return null
  }

  // Show disabled button while checking availability
  const isCheckingAvailability = isFeatureAvailable === null

  return (
    <>
      {!showComparison && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <Button
            size={size}
            variant="outline"
            onClick={(e) => handleProofread(e)}
            disabled={disabled || isLoading || isCheckingAvailability}
            loading={isLoading}
            loadingText="Proofreading..."
            className="border border-blue-500 text-blue-600 hover:bg-blue-50"
            type="button"
          >
            <HiSparkles className="mr-1" />
            {isLoading ? "Proofreading..." : "AI Proofread"}
          </Button>
        </div>
      )}

      {showComparison && (
        <ProofreadComparison
          originalText={originalText}
          proofreadText={proofreadText}
          onAccept={handleAccept}
          onReject={handleReject}
          onRetry={handleRetry}
          fieldLabel={fieldLabel}
          isRetrying={isLoading}
        />
      )}
    </>
  )
}

export default ProofreadButton
