"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Box, Text, Button, Spinner, Center } from "@chakra-ui/react";

const SuccessPageContent = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [childDetails, setChildDetails] = useState({
    name: '',
    location: '',
    email: ''
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const fetchSessionDetails = async () => {
      const sessionId = searchParams.get('session_id');
      if (!sessionId) {
        setError("Invalid session ID");
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/stripe/session?id=${sessionId}`);
        const data = await response.json();
        
        if (!response.ok) {
          // If session not found and we haven't retried too many times, retry after a delay
          if (data.code === 'SESSION_NOT_FOUND' && retryCount < 3) {
            console.log(`Session not found, retrying in 2 seconds (attempt ${retryCount + 1}/3)...`);
            setTimeout(() => {
              setRetryCount(prev => prev + 1);
            }, 2000);
            return;
          }
          
          if (data.code === 'SESSION_NOT_FOUND') {
            // If we've retried and still can't find the session, assume payment was successful
            // This is a fallback for when the session exists in Stripe but not in our database yet
            console.log('Session not found after retries, assuming payment success');
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
        
        const { session } = data;
        setChildDetails({
          name: session.metadata?.childName || 'your sponsored child',
          location: session.metadata?.childLocation || '',
          email: session.customer_details?.email || ''
        });
      } catch (error) {
        console.error('Error fetching session:', error);
        // Even if there's an error, assume payment was successful if we're on the success page
        // This is a fallback for when there are API issues but the payment went through
        setChildDetails({
          name: 'your sponsored child',
          location: '',
          email: ''
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchSessionDetails();
  }, [searchParams, retryCount]);

  if (isLoading) {
    return (
      <Center className="min-h-screen">
        <Box className="text-center">
          <Spinner size="xl" color="blue.500" mb={4} />
          <Text>
            {retryCount > 0 
              ? `Verifying payment status (attempt ${retryCount}/3)...` 
              : 'Loading payment details...'}
          </Text>
        </Box>
      </Center>
    );
  }

  if (error && !childDetails.name) {
    return (
      <Box className="p-8 text-center">
        <Text className="text-xl mb-4 text-red-600">
          {error}
        </Text>
        <Text className="mb-4 text-gray-600">
          If you believe you completed a payment, please check your email for confirmation or contact support.
        </Text>
        <Button
          onClick={() => router.push('/')}
          className="mt-4 bg-blue-700 text-white"
        >
          Return Home
        </Button>
      </Box>
    );
  }

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
        onClick={() => router.push('/')}
        className="mt-4 bg-blue-700 text-white"
      >
        Return Home
      </Button>
    </Box>
  );
};

export default function SuccessPage() {
  return (
    <Suspense fallback={<Center className="min-h-screen"><Spinner size="xl" color="blue.500" /></Center>}>
      <SuccessPageContent />
    </Suspense>
  );
}
