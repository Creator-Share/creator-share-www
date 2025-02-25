import React, { useEffect, useState } from 'react';
import { Box, Text, Flex, Spinner } from '@chakra-ui/react';
import { fetchActivitiesByChildId } from '@/actions';
import { Activity } from '@/types';

const ChildActivity = ({ childId }: { childId: string | undefined }) => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadActivities = async () => {
      if (!childId) {
        setLoading(false);
        return;
      }
      const data = await fetchActivitiesByChildId(childId);
      setActivities(data);
      setLoading(false);
    };

    loadActivities();
  }, [childId]);

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