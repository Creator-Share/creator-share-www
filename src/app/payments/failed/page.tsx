"use client";
import { Box, Text, Button, Flex, Spinner, Center } from "@chakra-ui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";

const FailedPageContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [childDetails, setChildDetails] = useState({
    name: 'this child',
    location: ''
  });
  const [isLoading, setIsLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const fetchSessionDetails = async () => {
      const sessionId = searchParams.get('session_id');
      if (!sessionId) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/stripe/session?id=${sessionId}`);
        const data = await response.json();
        
        if (!response.ok) {
          // If session not found and we haven't retried too many times, retry after a delay
          if (data.code === 'SESSION_NOT_FOUND' && retryCount < 2) {
            console.log(`Session not found, retrying in 1 second (attempt ${retryCount + 1}/2)...`);
            setTimeout(() => {
              setRetryCount(prev => prev + 1);
            }, 1000);
            return;
          }
          
          // For failed payments, we don't need to retry as much
          throw new Error(data.error || 'Failed to fetch session');
        }
        
        const { session } = data;
        setChildDetails({
          name: session.metadata?.childName || 'this child',
          location: session.metadata?.childLocation || ''
        });
      } catch (error) {
        console.error('Error fetching session:', error);
        // Even if we can't get the session, we can still show the failed page
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
          <Text>Loading payment details...</Text>
        </Box>
      </Center>
    );
  }

  return (
    <Box className="flex flex-col items-center justify-center min-h-screen p-4">
      {/* Error Icon */}
      <Box className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mb-6">
        <Box className="w-12 h-12 text-red-500">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </Box>
      </Box>

      <Box className="w-full max-w-xl text-center">
        <Text className="text-3xl font-semibold text-[#1C3C8C] mb-6">
          Oh no! Your Payment Didn't Go Through
        </Text>

        <Text className="text-gray-600 mb-8">
          It looks like something went wrong, and your sponsorship payment wasn't completed. But don't worry – it happens to the best of us!
        </Text>

        <Text className="text-gray-600 mb-8">
          You can still make a huge difference in {childDetails.name}'s life.<br />
          Let's give it another try
        </Text>

        <Flex direction="column" gap={4}>
          <Button
            onClick={() => router.back()}
            className="w-full bg-[#1C3C8C] text-white py-3 rounded-xl hover:bg-blue-800 transition-colors"
          >
            Retry Payment
          </Button>

          <Button
            onClick={() => router.push('/')}
            variant="ghost"
            className="text-[#1C3C8C]"
          >
            Back to Home
          </Button>
        </Flex>

        <Text className="text-gray-500 mt-8 text-sm">
          If you're running into any issues or have questions, we're here to help! Just reach out to us at{' '}
          <span className="text-blue-600">support@sharetanzania.co.uk</span> or visit our{' '}
          <span className="text-blue-600">Help Center</span>.
        </Text>
      </Box>
    </Box>
  );
};

const FailedPage = () => {
  return (
    <Suspense fallback={<Center className="min-h-screen"><Spinner size="xl" color="blue.500" /></Center>}>
      <FailedPageContent />
    </Suspense>
  );
};

export default FailedPage;
