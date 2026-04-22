"use client"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Box, Spinner, Text } from "@chakra-ui/react"
import { Beneficiaries, Activity } from "@/types"
import { fetchActivitiesByBeneficiaryId } from "@/actions"
import BeneficiaryModal from "../components/SponsorshipModal"

/**
 * Lightweight direct-link route for beneficiary profiles (e.g. /sponsorships/kfxg0n82).
 *
 * Only the single beneficiary record is fetched — the full paginated list is
 * intentionally NOT loaded here.  When the modal is closed the user is sent
 * back to the home page (or the previous page if the browser history allows it).
 */
export default function BeneficiaryProfilePage() {
  const { username } = useParams<{ username: string }>()
  const router = useRouter()

  const [beneficiary, setBeneficiary] = useState<Beneficiaries | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [activitiesLoading, setActivitiesLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Fetch the single beneficiary by username — no list pagination triggered.
  useEffect(() => {
    if (!username) return
    const controller = new AbortController()

    fetch(`/api/beneficiaries/get/username/${encodeURIComponent(username)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) {
          setNotFound(true)
          return null
        }
        return res.json() as Promise<{ beneficiary?: Beneficiaries }>
      })
      .then((data) => {
        if (data?.beneficiary) {
          setBeneficiary(data.beneficiary)
        } else if (data !== null) {
          setNotFound(true)
        }
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setNotFound(true)
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [username])

  // Fetch activities once we have the beneficiary id.
  useEffect(() => {
    if (!beneficiary?.id) return
    const controller = new AbortController()
    setActivitiesLoading(true)

    fetchActivitiesByBeneficiaryId(beneficiary.id, controller.signal)
      .then(setActivities)
      .catch((e) => {
        if (e?.name !== "AbortError") setActivities([])
      })
      .finally(() => setActivitiesLoading(false))

    return () => controller.abort()
  }, [beneficiary?.id])

  const handleClose = () => {
    // Back to the home page (all opportunities).
    router.push("/")
  }

  if (loading) {
    return (
      <Box
        minH="100vh"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Spinner size="xl" color="#2b7ff9" />
      </Box>
    )
  }

  if (notFound || !beneficiary) {
    return (
      <Box
        minH="100vh"
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        gap={4}
      >
        <Text fontSize="xl" fontWeight="semibold" color="gray.600">
          Profile not found
        </Text>
        <Text
          as="button"
          color="#2b7ff9"
          textDecor="underline"
          onClick={() => router.push("/")}
        >
          Browse all opportunities
        </Text>
      </Box>
    )
  }

  return (
    <Box minH="100vh">
      <BeneficiaryModal
        open={true}
        onClose={handleClose}
        beneficiary={beneficiary}
        activities={activities}
        activitiesLoading={activitiesLoading}
      />
    </Box>
  )
}
