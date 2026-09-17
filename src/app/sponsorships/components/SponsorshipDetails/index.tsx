import React, { useEffect, useState } from "react"
import { Stat, Text } from "@chakra-ui/react"
import { SponsorshipDetailsProps } from "@/types/propTypes"
import {
  fetchSponsorshipDetailsByBeneficiaryId,
  type PublicBeneficiarySponsorshipMilestone,
} from "@/actions"

const SponsorshipDetails: React.FC<SponsorshipDetailsProps> = ({
  beneficiaryId,
}) => {
  const [summary, setSummary] =
    useState<PublicBeneficiarySponsorshipMilestone | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadSubscriptions = async () => {
      if (!beneficiaryId) return
      const data = await fetchSponsorshipDetailsByBeneficiaryId(beneficiaryId)
      setSummary(data)
      setLoading(false)
    }

    loadSubscriptions()
  }, [beneficiaryId])

  return (
    <div className="bg-[#FFFFFF] rounded-[10px] border border-[#E4EAE7] pb-2 min-h-72 max-h-72 overflow-hidden overflow-y-scroll">
      <div className="p-6">
        <h2 className="text-base font-bold text-[#03150E]">
          Sponsorship Details
        </h2>
      </div>
      {loading ? (
        <Text color="gray.500" className="px-8 py-4">
          Loading sponsorships...
        </Text>
      ) : !summary ? (
        <Text color="gray.500" className="px-8 py-4">
          Detailed totals appear after at least five sponsorships.
        </Text>
      ) : (
        <div className="px-6">
          <Stat.Root>
            <Stat.Label>Public sponsorship milestone</Stat.Label>
            <Stat.ValueText>
              {summary.sponsorship_count_floor}+
            </Stat.ValueText>
            <Stat.HelpText>
              Public totals are shown only in groups of five to protect sponsor privacy.
            </Stat.HelpText>
          </Stat.Root>
        </div>
      )}
    </div>
  )
}

export default SponsorshipDetails
