"use client"
import React, { useEffect, useState } from "react"
import { Box, Spinner, Flex, Text, Button } from "@chakra-ui/react"
import { useParams } from "next/navigation"
import { Beneficiaries } from "@/types"
import BeneficiaryModal from "../components/SponsorshipModal"

export default function FullProfileDynamic() {
  const { username } = useParams()
  const [beneficiary, setBeneficiary] = useState<Beneficiaries | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [beneficiaries, setBeneficiaries] = useState<Beneficiaries[]>([])
  const [currentBeneficiaryIndex, setCurrentBeneficiaryIndex] = useState(0)

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError("")
      try {
        const res = await fetch(`/api/beneficiaries/get/username/${username}`)
        if (!res.ok) {
          throw new Error("Beneficiary not found")
        }
        const data = await res.json()
        const { child } = data
        if (!child) {
          throw new Error("Beneficiary data is empty")
        }
        setBeneficiary(child)
        if (child?.id) {
          const res = await fetch("/api/beneficiaries/get")
          const data = await res.json()
          if (data.people) {
            setBeneficiaries(data.people)
            const index = data.people.findIndex(
              (b: Beneficiaries) => b.username === username
            )
            if (index !== -1) {
              setCurrentBeneficiaryIndex(index)
            }
          }
        }
      } catch (err) {
        setError("Beneficiary not found.")
        setBeneficiary(null)
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    if (username) fetchData()
  }, [username])

  if (loading) {
    return (
      <Flex minH="100vh" align="center" justify="center">
        <Spinner size="xl" color="blue.500" />
      </Flex>
    )
  }

  if (error || !beneficiary) {
    return (
      <Flex minH="100vh" align="center" justify="center">
        <Text color="red.500" fontSize="xl">
          {error || "Beneficiary not found."}
        </Text>
      </Flex>
    )
  }

  // Just open the modal directly - the modal contains all the redesigned content
  return (
    <Box minH="100vh" p={6} pt={12}>
      <Box maxW="6xl" mx="auto">
        {/* Navigation */}
        <Flex justify="space-between" mb={8}>
          <Button
            onClick={() => {
              const newIndex = currentBeneficiaryIndex - 1
              if (newIndex >= 0 && beneficiaries[newIndex]?.username) {
                window.location.href = `/sponsorships/${beneficiaries[newIndex].username}`
              }
            }}
            disabled={currentBeneficiaryIndex === 0}
            variant="outline"
            className={`px-4 py-2 ${
              currentBeneficiaryIndex === 0
                ? "opacity-50 cursor-not-allowed"
                : ""
            }`}
          >
            ← Previous Beneficiary
          </Button>
          <Button
            onClick={() => {
              const newIndex = currentBeneficiaryIndex + 1
              if (
                newIndex < beneficiaries.length &&
                beneficiaries[newIndex]?.username
              ) {
                window.location.href = `/sponsorships/${beneficiaries[newIndex].username}`
              }
            }}
            disabled={currentBeneficiaryIndex === beneficiaries.length - 1}
            variant="outline"
            className={`px-4 py-2 ${
              currentBeneficiaryIndex === beneficiaries.length - 1
                ? "opacity-50 cursor-not-allowed"
                : ""
            }`}
          >
            Next Beneficiary →
          </Button>
        </Flex>

        {/* Show modal content directly on the page */}
        <BeneficiaryModal
          open={true}
          onClose={() => (window.location.href = "/")}
          beneficiary={beneficiary}
        />
      </Box>
    </Box>
  )
}
