"use client"
import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { toaster } from "@/components/ui/toaster"
import ProofreadModal from "./ProofreadModal"
import { HiSparkles } from "react-icons/hi"

interface ProofreadButtonProps {
  text: string
  onAccept: (proofreadText: string) => void
  fieldLabel?: string
  disabled?: boolean
  size?: "xs" | "sm" | "md" | "lg"
}

const ProofreadButton: React.FC<ProofreadButtonProps> = ({
  text,
  onAccept,
  fieldLabel = "Text",
  disabled = false,
  size = "sm",
}) => {
  const [isLoading, setIsLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [proofreadText, setProofreadText] = useState("")

  const handleProofread = async (e?: React.MouseEvent) => {
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
        duration: 3000,
      })
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch("/api/ai/proofread", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to proofread text")
      }

      setProofreadText(data.proofreadText)
      setIsModalOpen(true)
    } catch (error) {
      console.error("Proofread error:", error)
      toaster.create({
        title: "Proofreading failed",
        description:
          error instanceof Error
            ? error.message
            : "An error occurred while proofreading. Please try again.",
        type: "error",
        duration: 5000,
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleAccept = (text: string) => {
    onAccept(text)
    toaster.create({
      title: "Text updated",
      description: "AI suggestions have been applied successfully.",
      type: "success",
      duration: 3000,
    })
  }

  return (
    <>
      <Button
        size={size}
        variant="outline"
        onClick={(e) => handleProofread(e)}
        disabled={disabled || isLoading}
        loading={isLoading}
        loadingText="Proofreading..."
        className="border border-blue-500 text-blue-600 hover:bg-blue-50"
        type="button"
      >
        <HiSparkles className="mr-1" />
        {isLoading ? "Proofreading..." : "AI Proofread"}
      </Button>

      {isModalOpen && (
        <ProofreadModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          originalText={text}
          proofreadText={proofreadText}
          onAccept={handleAccept}
          fieldLabel={fieldLabel}
        />
      )}
    </>
  )
}

export default ProofreadButton
