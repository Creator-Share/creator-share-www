"use client"
import { useState, useEffect, useCallback } from "react"
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogCloseTrigger,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Box, Text, Flex, Spinner, Grid, Image } from "@chakra-ui/react"
import { createClient } from "@/utils/supabase/client"
import { isOpenSponsorshipType } from "@/config/beneficiaryTypes"

interface BeneficiaryWithImages {
  id: string
  name: string
  username: string
  birth_date?: string
  age?: number
  status: string
  budget_goal: number
  budget_raised: number
  beneficiary_type?: string | null
  location_str?: string
  gender?: string
  biography?: string
  images?: Array<{
    id: string
    image_url: string
    is_primary?: boolean
  }>
}

interface BeneficiarySelectionModalProps {
  isOpen: boolean
  onClose: () => void
  subscriptionId: string
  onSuccess: () => void
}

export const BeneficiarySelectionModal: React.FC<BeneficiarySelectionModalProps> = ({
  isOpen,
  onClose,
  subscriptionId,
  onSuccess,
}) => {
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryWithImages[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<BeneficiaryWithImages | null>(null)
  const [assigning, setAssigning] = useState(false)

  const calculateAge = (birthDate: string | null | undefined): number | undefined => {
    if (!birthDate) return undefined
    const birth = new Date(birthDate)
    const today = new Date()
    let age = today.getFullYear() - birth.getFullYear()
    const monthDiff = today.getMonth() - birth.getMonth()
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--
    }
    return age
  }

  const fetchAvailableBeneficiaries = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    // Fetch beneficiaries
    const { data, error } = await supabase
      .from("beneficiaries")
      .select(`
        id,
        name,
        username,
        birth_date,
        status,
        budget_goal,
        budget_raised,
        beneficiary_type,
        location_str,
        gender,
        biography
      `)
      .or('and(status.in.("New","Partially Funded"),goal_fulfilled_at.is.null),and(budget_goal.eq.-1,status.not.in.(Draft,Archived))')
      .order("sort_weight", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(20)

    if (error) {
      console.error("Error fetching beneficiaries:", error)
      setLoading(false)
      return
    }

    // Filter beneficiaries that still need funding and add calculated age
    const available = (data || [])
      .map((b) => ({
        ...b,
        age: calculateAge(b.birth_date)
      }))
      .filter((b) => {
        // Open sponsorship types (budget_goal = -1) are always available
        if (isOpenSponsorshipType(b.beneficiary_type)) return true
        const remaining = (b.budget_goal || 0) - (b.budget_raised || 0)
        return remaining > 0
      })

    // Fetch media for all beneficiaries
    if (available.length > 0) {
      const beneficiaryIds = available.map(b => b.id)
      const { data: mediaData, error: mediaError } = await supabase
        .from("media")
        .select("id, parent_id, extension, type, weight")
        .in("parent_id", beneficiaryIds)
        .eq("type", "IMAGE")
        .order("weight", { ascending: false })

      if (mediaError) {
        console.error("Error fetching media:", mediaError)
      } else {
        // Attach media to beneficiaries
        const beneficiariesWithMedia = available.map(beneficiary => {
          const beneficiaryMedia = (mediaData || [])
            .filter(m => m.parent_id === beneficiary.id)
            .map(m => ({
              id: m.id,
              image_url: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${m.parent_id}/${m.type}/${m.id}.${m.extension}`,
              is_primary: m.weight > 0
            }))
          
          return {
            ...beneficiary,
            images: beneficiaryMedia
          }
        })
        
        setBeneficiaries(beneficiariesWithMedia)
        setLoading(false)
        return
      }
    }

    setBeneficiaries(available)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (isOpen) {
      fetchAvailableBeneficiaries()
    }
  }, [isOpen, fetchAvailableBeneficiaries])

  const handleAssign = async () => {
    if (!selectedBeneficiary) return

    setAssigning(true)
    try {
      const response = await fetch("/api/sponsorships/self-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscriptionId,
          beneficiaryId: selectedBeneficiary.id,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Failed to assign beneficiary")
      }

      // Success
      onSuccess()
      onClose()
    } catch (error) {
      console.error("Error assigning beneficiary:", error)
      alert(
        `Error assigning beneficiary: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    } finally {
      setAssigning(false)
    }
  }

  const getPrimaryImage = (beneficiary: BeneficiaryWithImages) => {
    const images = beneficiary.images || []
    const primaryImage = images.find((img: { is_primary?: boolean }) => img.is_primary)
    return primaryImage?.image_url || images[0]?.image_url || "/placeholder.png"
  }

  return (
    <DialogRoot
      open={isOpen}
      onOpenChange={(details) => {
        if (!details.open && !assigning) {
          onClose()
          setSelectedBeneficiary(null)
        }
      }}
    >
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <Text className="text-xl font-semibold">Choose a Child to Sponsor</Text>
          <DialogCloseTrigger disabled={assigning} />
        </DialogHeader>
        <DialogBody>
          {loading ? (
            <Flex direction="column" align="center" gap={4} py={8}>
              <Spinner size="lg" color="#2b7ff9" />
              <Text>Loading available children...</Text>
            </Flex>
          ) : beneficiaries.length === 0 ? (
            <Flex direction="column" align="center" gap={4} py={8}>
              <Text fontSize="lg" color="gray.600">
                No children available for sponsorship at this time.
              </Text>
              <Text fontSize="sm" color="gray.500">
                Please check back later or contact support.
              </Text>
            </Flex>
          ) : (
            <Flex direction="column" gap={4}>
              <Text fontSize="sm" color="gray.600" mb={2}>
                Select a child you would like to sponsor. You can browse their profiles to learn
                more about them.
              </Text>

              <Grid templateColumns="repeat(auto-fill, minmax(280px, 1fr))" gap={4}>
                {beneficiaries.map((beneficiary) => {
                  const isOpenType = isOpenSponsorshipType(beneficiary.beneficiary_type)
                  const remaining = isOpenType ? 0 : (beneficiary.budget_goal || 0) - (beneficiary.budget_raised || 0)
                  const percentFunded = isOpenType ? 0 :
                    ((beneficiary.budget_raised || 0) / (beneficiary.budget_goal || 1)) * 100

                  return (
                    <Box
                      key={beneficiary.id}
                      className={`border rounded-lg p-4 cursor-pointer transition-all ${
                        selectedBeneficiary?.id === beneficiary.id
                          ? "border-blue-500 bg-blue-50 shadow-md"
                          : "border-gray-200 hover:border-blue-300 hover:shadow-sm"
                      }`}
                      onClick={() => setSelectedBeneficiary(beneficiary)}
                    >
                      <Box className="relative mb-3">
                        <Image
                          src={getPrimaryImage(beneficiary)}
                          alt={beneficiary.name}
                          className="w-full h-48 object-cover rounded-lg"
                        />
                        {selectedBeneficiary?.id === beneficiary.id && (
                          <Box className="absolute top-2 right-2 bg-blue-500 text-white rounded-full w-8 h-8 flex items-center justify-center">
                            ✓
                          </Box>
                        )}
                      </Box>

                      <Text fontWeight="bold" fontSize="lg" mb={1}>
                        {beneficiary.name}
                      </Text>

                      {beneficiary.age && (
                        <Text fontSize="sm" color="gray.600" mb={1}>
                          Age {beneficiary.age}
                        </Text>
                      )}

                      {beneficiary.location_str && (
                        <Text fontSize="sm" color="gray.600" mb={2}>
                          📍 {beneficiary.location_str}
                        </Text>
                      )}

                      {isOpenType ? (
                        <Box className="mb-2">
                          <Text fontSize="xs" color="blue.600" fontWeight="semibold">
                            Open sponsorship — choose your amount
                          </Text>
                        </Box>
                      ) : (
                        <Box className="mb-2">
                          <Flex justify="space-between" mb={1}>
                            <Text fontSize="xs" color="gray.600">
                              Funding Progress
                            </Text>
                            <Text fontSize="xs" fontWeight="semibold" color="blue.600">
                              {Math.round(percentFunded)}%
                            </Text>
                          </Flex>
                          <Box className="w-full bg-gray-200 rounded-full h-2">
                            <Box
                              className="bg-blue-500 h-2 rounded-full transition-all"
                              style={{ width: `${Math.min(percentFunded, 100)}%` }}
                            />
                          </Box>
                          <Text fontSize="xs" color="gray.500" mt={1}>
                            ${(remaining / 100).toFixed(2)} remaining
                          </Text>
                        </Box>
                      )}

                      {beneficiary.biography && (
                        <Text fontSize="sm" color="gray.700" className="line-clamp-2">
                          {beneficiary.biography}
                        </Text>
                      )}

                      <a
                        href={`/sponsorships/${beneficiary.username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 text-sm mt-2 inline-block"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View Full Profile →
                      </a>
                    </Box>
                  )
                })}
              </Grid>
            </Flex>
          )}
        </DialogBody>
        <DialogFooter>
          <Flex gap={3} width="100%" justify="flex-end">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={assigning}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAssign}
              disabled={!selectedBeneficiary || assigning}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {assigning ? (
                <>
                  <Spinner size="sm" mr={2} />
                  Assigning...
                </>
              ) : (
                "Assign to Selected Child"
              )}
            </Button>
          </Flex>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  )
}
