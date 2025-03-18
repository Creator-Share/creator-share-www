'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Box, Text, Button } from '@chakra-ui/react';

const ReturnContent = () => {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<string | null>(null);
  const [childDetails, setChildDetails] = useState({
    name: '',
    location: '',
    email: ''
  });

  useEffect(() => {
    const fetchSession = async () => {
      const sessionId = searchParams.get('session_id');
      if (!sessionId) return;

      try {
        const response = await fetch(`/api/stripe/session?id=${sessionId}`);
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch session');
        }
        
        const { session } = data;
        setStatus(session.status);
        setChildDetails({
          name: session.metadata.childName || '',
          location: session.metadata.childLocation || '',
          email: session.customer_details?.email || ''
        });
      } catch (error) {
        console.error('Error fetching session:', error);
      }
    };

    fetchSession();
  }, [searchParams]);

  if (status === 'complete') {
    return (
      <Box className="p-8 text-center">
        <Text className="text-xl mb-4">
          Thank you for sponsoring {childDetails.name}!
        </Text>
        <Text>
          A confirmation email will be sent to {childDetails.email}.
        </Text>
        <Button
          onClick={() => window.location.href = '/'}
          className="mt-4 bg-blue-700 text-white"
        >
          Return Home
        </Button>
      </Box>
    );
  }

  if (status === 'open') {
    return (
      <Box className="p-8 text-center">
        <Text>Payment not completed. Please try again.</Text>
        <Button
          onClick={() => window.history.back()}
          className="mt-4 bg-blue-700 text-white"
        >
          Go Back
        </Button>
      </Box>
    );
  }

  return <Box className="p-8 text-center">Processing...</Box>;
};

export default function Return() {
  return (
    <Suspense fallback={<Box className="p-8 text-center">Loading...</Box>}>
      <ReturnContent />
    </Suspense>
  );
} 