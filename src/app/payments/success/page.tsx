"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Box, Text, Button } from "@chakra-ui/react";

const SuccessPageContent = () => {
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
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch session');
        }
        
        const { session } = data;
        setChildDetails({
          name: session.metadata.childName || '',
          location: session.metadata.childLocation || '',
          email: session.customer_details.email || ''
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
};

export default function SuccessPage() {
  return (
    <Suspense fallback={<Box className="flex items-center justify-center min-h-screen">Loading...</Box>}>
      <SuccessPageContent />
    </Suspense>
  );
}
