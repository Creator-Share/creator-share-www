"use client";
import { Box, Text, Button, Flex } from "@chakra-ui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";

const FailedPageContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [childDetails, setChildDetails] = useState({
    name: '',
    location: ''
  });

  useEffect(() => {
    const fetchSessionDetails = async () => {
      const sessionId = searchParams.get('session_id');
      if (!sessionId) return;

      try {
        const response = await fetch(`/api/stripe/session?id=${sessionId}`);
        if (!response.ok) throw new Error('Failed to fetch session');
        
        const { session } = await response.json();
        setChildDetails({
          name: session.metadata.childName || '',
          location: session.metadata.childLocation || ''
        });
      } catch (error) {
        console.error('Error fetching session:', error);
      }
    };

    fetchSessionDetails();
  }, [searchParams]);

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
    <Suspense fallback={<Box className="flex items-center justify-center min-h-screen">Loading...</Box>}>
      <FailedPageContent />
    </Suspense>
  );
};

export default FailedPage;
