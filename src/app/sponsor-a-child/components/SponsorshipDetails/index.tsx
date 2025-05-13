import React, { useEffect, useState } from 'react'
import { Box, Text, Table, Badge } from '@chakra-ui/react'
import { centsToDollars } from '@/utils/currency'
import { formatDate } from '@/utils/dateFormatter'
import { Subscription } from '@/types'

interface SponsorshipDetailsProps {
  sponsorshipId: string | undefined;
}

const SponsorshipDetails: React.FC<SponsorshipDetailsProps> = ({ sponsorshipId }) => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadSubscriptions = async () => {
      if (!sponsorshipId) {
        setLoading(false);
        return;
      }
      try {
        const response = await fetch(`/api/subscriptions/${sponsorshipId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch subscriptions');
        }
        const data = await response.json();
        setSubscriptions(data.subscriptions);
      } catch (error) {
        console.error('Error fetching subscriptions:', error);
        setSubscriptions([]);
      } finally {
        setLoading(false);
      }
    }

    loadSubscriptions()
  }, [sponsorshipId])

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'complete':
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
