import React, { useEffect, useState } from 'react';
import { Box, Text, Flex, Spinner } from '@chakra-ui/react';
import { Activity } from '@/types';

interface ChildActivityProps {
  sponsorshipId: string | undefined;
}

const ChildActivity: React.FC<ChildActivityProps> = ({ sponsorshipId }) => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadActivities = async () => {
      if (!sponsorshipId) {
        setLoading(false);
        return;
      }
      try {
        const response = await fetch(`/api/activities/${sponsorshipId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch activities');
        }
        const data = await response.json();
        setActivities(data.activities);
      } catch (error) {
        console.error('Error fetching activities:', error);
        setActivities([]);
      } finally {
        setLoading(false);
      }
    };

    loadActivities();
  }, [sponsorshipId]);

  return (
    <Box borderWidth="1px" borderRadius="md" p={4} boxShadow="md" maxHeight="400px" overflowY="auto">
      <Text fontSize="lg" fontWeight="bold" mb={4}>
        Activities
      </Text>
      {loading ? (
        <Flex justify="center" align="center">
          <Spinner />
        </Flex>
      ) : activities.length === 0 ? (
        <Text color="gray.500">No activities yet...</Text>
      ) : (
        activities.map((activity) => (
          <Box key={activity.id} mb={2} p={2} borderWidth="1px" borderRadius="md">
            <Text>{activity.description}</Text>
            <Text fontSize="sm" color="gray.400">
              {new Date(activity.created_at).toLocaleString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </Text>
          </Box>
        ))
      )}
    </Box>
  );
};

export default ChildActivity;
