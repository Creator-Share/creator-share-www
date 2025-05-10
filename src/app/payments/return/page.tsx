'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Box, Text, Button, Spinner } from '@chakra-ui/react';

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
  const [retryCount, setRetryCount] = useState(0);
  const isEmbedded = searchParams.get('embedded') === 'true';

  useEffect(() => {
    const isInIframe = window.self !== window.top;
    
    const fetchSession = async () => {
      const sessionId = searchParams.get('session_id');
      if (!sessionId) {
        setError('Missing payment session information');
        setIsLoading(false);
        return;
      }

      try {
        if (isEmbedded && isInIframe) {
          console.log('Embedded checkout detected, assuming payment success');
          setStatus('complete');
          setChildDetails({
            name: 'your sponsored child',
            location: '',
            email: ''
          });

          window.parent.postMessage({ 
            type: 'sponsorship_complete',
            childName: 'your sponsored child'
          }, '*');
          
          setIsLoading(false);
          return;
        }

        const response = await fetch(`/api/stripe/session?id=${sessionId}`);
        const data = await response.json();
        
        if (!response.ok) {
          if (data.code === 'SESSION_NOT_FOUND' && retryCount < 3) {
            console.log(`Session not found, retrying in 2 seconds (attempt ${retryCount + 1}/3)...`);
            setTimeout(() => {
              setRetryCount(prev => prev + 1);
            }, 2000);
            return;
          }
          
          if (data.code === 'SESSION_NOT_FOUND') {
            setStatus('complete');
            setChildDetails({
              name: 'your sponsored child',
              location: '',
              email: ''
            });
            setIsLoading(false);
            return;
          }
          
          throw new Error(data.error || 'Failed to fetch session');
        }
        
        const { session, status: sessionStatus } = data;
        
        setStatus(sessionStatus || session.status);
        setChildDetails({
          name: session.metadata?.childName || 'your sponsored child',
          location: session.metadata?.childLocation || '',
          email: session.customer_details?.email || ''
        });

        if (isEmbedded && (sessionStatus === 'complete' || session.status === 'complete')) {
          window.parent.postMessage({ 
            type: 'sponsorship_complete',
            childName: session.metadata?.childName
          }, '*');
        }
      } catch (error) {
        console.error('Error fetching session:', error);

        setStatus('complete');
        setChildDetails({
          name: 'your sponsored child',
          location: '',
          email: ''
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchSession();

    if (isEmbedded) {
      const sendHeight = () => {
        const height = document.documentElement.scrollHeight;
        window.parent.postMessage({ type: 'resize', height }, '*');
      };

      const observer = new ResizeObserver(sendHeight);
      observer.observe(document.body);
      return () => observer.disconnect();
    }
  }, [searchParams, isEmbedded, retryCount]);

  const handleReturn = () => {
    if (isEmbedded) {
      window.parent.postMessage({ type: 'navigation', action: 'return' }, '*');
    } else {
      router.push('/');
    }
  };

  if (isLoading) {
    return (
      <Box className="p-8 text-center">
        <Spinner size="xl" color="blue.500" mb={4} />
        <Text>
          {retryCount > 0 
            ? `Verifying payment status (attempt ${retryCount}/3)...` 
            : 'Loading payment status...'}
        </Text>
      </Box>
    );
  }

  if (error && status !== 'complete') {
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
      <Text>Thank you for your sponsorship!</Text>
      <Text className="mb-4">Your payment is being processed.</Text>
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
