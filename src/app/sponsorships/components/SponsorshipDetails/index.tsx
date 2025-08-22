import React, { useEffect, useState } from 'react'
import { Text } from '@chakra-ui/react'
import { centsToDollars } from '@/utils/currency'
import { format } from 'date-fns'
import { Subscription } from '@/types'
import { SponsorshipDetailsProps } from '@/types/propTypes'
import { fetchSponsorshipDetailsByBeneficiaryId } from '@/actions'

const getStatusStyle = (status: string) => {
  if (status.toLowerCase() === 'success') {
    return 'bg-[#E6F4EA] text-[#2ECC71]';
  }
  if (status.toLowerCase() === 'pending') {
    return 'bg-[#FFF4E5] text-[#FFA500]';
  }
  return 'bg-gray-100 text-gray-600';
};

const formatDate = (date: string) => {
  return format(new Date(date), "d MMMM, yyyy h:mmaaa").replace('AM', 'AM').replace('PM', 'PM');
};

const SponsorshipDetails: React.FC<SponsorshipDetailsProps> = ({ beneficiaryId, hideStatus, hideAmount }) => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadSubscriptions = async () => {
      if (!beneficiaryId) return;
      const data = await fetchSponsorshipDetailsByBeneficiaryId(beneficiaryId)
      setSubscriptions(data)
      setLoading(false)
    }

    loadSubscriptions()
  }, [beneficiaryId])

  return (
    <div className="bg-[#FFFFFF] rounded-[10px] border border-[#E4EAE7] pb-2 min-h-72 max-h-72 overflow-hidden overflow-y-scroll">
      <div className="p-6">
        <h2 className="text-base font-bold text-[#03150E]">Sponsorship Details</h2>
      </div>
      {loading ? (
        <Text color="gray.500" className="px-8 py-4">Loading sponsorships...</Text>
      ) : subscriptions.length === 0 ? (
        <Text color="gray.500" className="px-8 py-4">No sponsorships yet</Text>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[600px] overflow-hidden">
            <thead className='bg-[#E4EAE7] border-y-2 border-[#E4EAE7]'>
              <tr>
                <th className="text-left text-xs font-normal text-[#6B7772] py-3 px-4">DATE</th>
                <th className="text-left text-xs font-normal text-[#6B7772] py-3 px-4">DESCRIPTION</th>
                {!hideStatus && (
                  <th className="text-left text-xs font-normal text-[#6B7772] py-3 px-4">AMOUNT</th>
                )}
                {!hideStatus && (
                  <th className="text-left text-xs font-normal text-[#6B7772] py-3 px-4">STATUS</th>
                )}
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((subscription) => (
                <tr key={subscription.id} className='border-y-[1px] border-[#E4EAE7]'>
                  <td className="py-3 px-4 text-sm text-[#222]">
                    {formatDate(subscription.created_at)}
                  </td>
                  <td className="py-3 px-4 text-sm font-bold text-[#222]">
                    {subscription.interval === 'year' ? 'Annual Sponsorship' : 'Monthly Sponsorship'}
                  </td>
                  {!hideAmount && (
                    <td className="py-3 px-4 text-sm text-[#222]">
                      ${centsToDollars(subscription.amount)}
                    </td>
                  )}
                  {!hideStatus && (
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-block rounded-full px-4 py-1 text-xs font-medium ${getStatusStyle(subscription.status)}`}>
                        {subscription.status === "success" ? "Success" : subscription.status === "pending" ? "Pending" : subscription.status}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default SponsorshipDetails
