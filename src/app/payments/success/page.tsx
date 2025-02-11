"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, Text, Flex, Button } from "@chakra-ui/react";

const SuccessPageContent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [childDetails, setChildDetails] = useState({
    name: '',
    location: '',
    email: ''
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchSessionDetails = async () => {
      const sessionId = searchParams.get('session_id');
      if (!sessionId) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/stripe/session?id=${sessionId}`);
        if (!response.ok) throw new Error('Failed to fetch session');
        
        const { session } = await response.json();
        setChildDetails({
          name: session.metadata.childName || '',
          location: session.metadata.childLocation || '',
          email: localStorage.getItem('userEmail') || ''
        });
      } catch (error) {
        console.error('Error fetching session:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSessionDetails();
  }, [searchParams]);

  if (isLoading) {
    return <Box className="flex items-center justify-center min-h-screen">Loading...</Box>;
  }

  return (
    <Box className="flex flex-col items-center justify-center min-h-screen p-4">
      {/* Success Icon */}
      <Box className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center mb-6">
        <Box className="w-12 h-12 text-emerald-500">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
          </svg>
        </Box>
      </Box>

      {/* Main Content */}
      <Box className="w-full max-w-xl text-center">
        <Text className="text-3xl font-semibold text-[#1C3C8C] mb-6">
          Thank You for Changing a Life!
        </Text>

        <Text className="text-gray-600 mb-8">
          Your generous sponsorship payment has been successfully processed.
          Because of you, {childDetails.name} is one step closer to a brighter future.
        </Text>

        {/* Sponsorship Details */}
        <Box className="bg-gray-50 p-6 rounded-lg mb-8">
          <Text className="font-semibold text-xl mb-4">Sponsorship Details</Text>
          
          <Flex direction="column" gap={3}>
            <Flex justify="space-between" className="border-b pb-2">
              <Text className="text-gray-600">Child's Name</Text>
              <Text className="font-medium">{childDetails.name}</Text>
            </Flex>
            
            <Flex justify="space-between" className="border-b pb-2">
              <Text className="text-gray-600">Location</Text>
              <Text className="font-medium">{childDetails.location}</Text>
            </Flex>
            
            <Flex justify="space-between" className="border-b pb-2">
              <Text className="text-gray-600">Confirmation Email</Text>
              <Text className="font-medium">
                Sent to <span className="text-blue-600">{childDetails.email}</span>
              </Text>
            </Flex>
          </Flex>
        </Box>

        <Text className="text-gray-600 mb-8">
          You'll receive updates about {childDetails.name}'s progress and how your support is making a difference.
        </Text>

        <Button
          onClick={() => router.push('/')}
          className="w-full bg-[#1C3C8C] text-white py-3 rounded-lg hover:bg-blue-800 transition-colors"
        >
          Back to Home
        </Button>
      </Box>
    </Box>
  );
};

const SuccessPage = () => {
  return (
    <Suspense fallback={<Box className="flex items-center justify-center min-h-screen">Loading...</Box>}>
      <SuccessPageContent />
    </Suspense>
  );
};

export default SuccessPage;
