import React, { useEffect, useState } from 'react'
import { Box, Text, Table, Badge } from '@chakra-ui/react'
import { createClient } from '@/utils/supabase/client'
import { centsToDollars } from '@/utils/currency'
import { formatDate } from '@/utils/dateFormatter'
import { Subscription } from '@/types'
import { SponsorshipDetailsProps } from '@/types/propTypes'

const SponsorshipDetails: React.FC<SponsorshipDetailsProps> = ({ childId }) => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchSubscriptions = async () => {
      if (!childId) return

      const supabase = createClient()
      const { data, error } = await supabase
        .from('subscriptions')
        .select(`
          *,
          child:sponsor_people(
            name
          )
        `)
        .eq('child_id', childId)
        .order('created_at', { ascending: false })
        console.log(data)

      if (error) {
        console.error('Error fetching subscriptions:', error)
        return
      }

      setSubscriptions(data || [])
      setLoading(false)
    }

    fetchSubscriptions()
  }, [childId])

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'active':
        return 'green'
      case 'incomplete':
        return 'yellow'
      case 'cancelled':
        return 'red'
      default:
        return 'gray'
    }
  }

  return (
    <Box borderWidth="1px" borderRadius={{ base: 'lg', md: 'md' }} p={8}>
      <Text className='text-base font-bold border-b border-gray-200 pb-4'>
        Sponsorship Details
      </Text>
      
      {loading ? (
        <Text mt={4} color="gray.500">Loading sponsorships...</Text>
      ) : subscriptions.length === 0 ? (
        <Text mt={4} color="gray.500">No sponsorships yet</Text>
      ) : (
        <Table.Root size="sm" variant="outline">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Date</Table.ColumnHeader>
              <Table.ColumnHeader>Amount</Table.ColumnHeader>
              <Table.ColumnHeader>Interval</Table.ColumnHeader>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {subscriptions.map((subscription) => (
              <Table.Row key={subscription.id}>
                <Table.Cell>{formatDate(subscription.created_at)}</Table.Cell>
                <Table.Cell>${centsToDollars(subscription.amount)}</Table.Cell>
                <Table.Cell className="capitalize">{subscription.interval}</Table.Cell>
                <Table.Cell>
                  <Badge 
                    colorScheme={getStatusColor(subscription.status)}
                    variant="subtle"
                  >
                    {subscription.status}
                  </Badge>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </Box>
  )
}

export default SponsorshipDetails