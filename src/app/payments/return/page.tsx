'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Box, Text, Button } from '@chakra-ui/react';

const ReturnContent = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [childDetails, setChildDetails] = useState({
    name: '',
    location: '',
    email: ''
  });
  const [isLoading, setIsLoading] = useState(true);
  const isEmbedded = searchParams.get('embedded') === 'true';

  useEffect(() => {
    const fetchSession = async () => {
      const sessionId = searchParams.get('session_id');
      if (!sessionId) {
        setError('Missing payment session information');
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/stripe/session?id=${sessionId}`);
        const data = await response.json();
        
        if (!response.ok) {
          if (data.code === 'SESSION_NOT_FOUND') {
            throw new Error('Payment session not found. If you completed a payment, please check your email for confirmation.');
          }
          throw new Error(data.error || 'Failed to fetch session');
        }
        
        const { session, status: sessionStatus } = data;
        
        setStatus(sessionStatus || session.status);
        setChildDetails({
          name: session.metadata?.childName || '',
          location: session.metadata?.childLocation || '',
          email: session.customer_details?.email || ''
        });

        // Notify parent frame of success if in embedded mode
        if (isEmbedded && (sessionStatus === 'complete' || session.status === 'complete')) {
          window.parent.postMessage({ 
            type: 'sponsorship_complete',
            childName: session.metadata?.childName
          }, '*');
        }
      } catch (error) {
        console.error('Error fetching session:', error);
        setError(error instanceof Error ? error.message : 'Unable to retrieve payment details');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSession();

    // Update iframe height
    if (isEmbedded) {
      const sendHeight = () => {
        const height = document.documentElement.scrollHeight;
        window.parent.postMessage({ type: 'resize', height }, '*');
      };

      const observer = new ResizeObserver(sendHeight);
      observer.observe(document.body);
      return () => observer.disconnect();
    }
  }, [searchParams, isEmbedded]);

  const handleReturn = () => {
    if (isEmbedded) {
      // For embedded mode, notify parent frame to handle navigation
      window.parent.postMessage({ type: 'navigation', action: 'return' }, '*');
    } else {
      // For normal mode, use router
      router.push('/');
    }
  };

  if (isLoading) {
    return <Box className="p-8 text-center">Loading...</Box>;
  }

  if (error) {
    return (
      <Box className="p-8 text-center">
        <Text className="text-xl mb-4 text-red-600">
          {error}
        </Text>
        <Text className="mb-4 text-gray-600">
          If you believe you completed a payment, please check your email for confirmation or contact support.
        </Text>
        <Button
          onClick={handleReturn}
          className="mt-4 bg-blue-700 text-white"
        >
          Return
        </Button>
      </Box>
    );
  }

  if (status === 'complete' || status === 'completed') {
    return (
      <Box className="p-8 text-center">
        <Text className="text-xl mb-4">
          Thank you for sponsoring {childDetails.name}!
        </Text>
        {childDetails.email && (
          <Text className="mb-4">
            A confirmation email will be sent to {childDetails.email}.
          </Text>
        )}
        <Button
          onClick={handleReturn}
          className="mt-4 bg-blue-700 text-white"
        >
          Return
        </Button>
      </Box>
    );
  }

  if (status === 'open') {
    return (
      <Box className="p-8 text-center">
        <Text>Payment not completed. Please try again.</Text>
        <Button
          onClick={handleReturn}
          className="mt-4 bg-blue-700 text-white"
        >
          Go Back
        </Button>
      </Box>
    );
  }

  return (
    <Box className="p-8 text-center">
      <Text>Unable to determine payment status.</Text>
      <Button
        onClick={handleReturn}
        className="mt-4 bg-blue-700 text-white"
      >
        Return
      </Button>
    </Box>
  );
};

export default function Return() {
  return (
    <Suspense fallback={<Box className="p-8 text-center">Loading...</Box>}>
      <ReturnContent />
    </Suspense>
  );
} 