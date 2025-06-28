"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Box, Text, Button, Spinner, Center, Flex, VStack } from "@chakra-ui/react";

const SuccessPageContent = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [paymentDetails, setPaymentDetails] = useState({
    type: '',
    name: '',
    location: '',
    email: '',
    project: '',
    amount: '',
    frequency: ''
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
          if (data.code === 'SESSION_NOT_FOUND' && retryCount < 3) {
            setTimeout(() => {
              setRetryCount(prev => prev + 1);
            }, 2000);
            return;
          }
          
          if (data.code === 'SESSION_NOT_FOUND') {
            setPaymentDetails({
              type: '',
              name: 'your sponsored child',
              location: '',
              email: '',
              project: '',
              amount: '',
              frequency: ''
            });
            setIsLoading(false);
            return;
          }
          
          throw new Error(data.error || 'Failed to fetch session');
        }
        
        const { session } = data;
        const isPartnership = session.metadata?.type === 'partnership';
        
        setPaymentDetails({
          type: isPartnership ? 'partnership' : 'sponsorship',
          name: isPartnership ? '' : (session.metadata?.childName || 'your sponsored child'),
          location: isPartnership ? '' : (session.metadata?.childLocation || ''),
          email: session.customer_details?.email || '',
          project: isPartnership ? session.metadata?.project || 'Area of greatest need' : '',
          amount: session.metadata?.amount ? `$${parseInt(session.metadata.amount) / 100}` : '',
          frequency: session.metadata?.paymentType === 'subscription' ? 'Monthly' : 'Yearly'
        });
      } catch (error) {
        console.error('Error fetching session:', error);
        setPaymentDetails({
          type: '',
          name: 'your sponsored child',
          location: '',
          email: '',
          project: '',
          amount: '',
          frequency: ''
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

  if (error && !paymentDetails.name) {
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
    <Center className="min-h-screen bg-gray-50">
      <Box 
        maxW="md" 
        w="full" 
        bg="white" 
        p={8} 
        borderRadius="2xl" 
        boxShadow="md" 
        className="text-center mx-4"
      >
        {/* Success Icon */}
        <Center mb={6}>
          <Box 
            borderRadius="full" 
            bg="#009C5E" 
            p={4} 
            width="80px" 
            height="80px" 
            display="flex" 
            alignItems="center" 
            justifyContent="center"
          >
            <Box as="span" color="#FFFFFF" fontSize="2xl" fontWeight="bold">✓</Box>
          </Box>
        </Center>

        {/* Heading */}
        <Text 
          fontSize="2xl" 
          fontWeight="bold" 
          mb={4} 
          color="#1C3C8C"
          className="text-center"
        >
          Thank You for Changing a Life!
        </Text>
        <Text mb={6} color="gray.600" fontSize="sm" className="text-center">
          {paymentDetails.type === 'partnership' ? (
            <>Your generous partnership payment has been successfully processed. Your support helps us continue our mission to help children in need.</>
          ) : (
            <>Your generous sponsorship payment has been successfully processed. Because of you, {paymentDetails.name} is one step closer to a brighter future.</>
          )}
        </Text>
        <Box mb={6}>
          <Text 
            fontWeight="semibold" 
            mb={4} 
            color="#2c3e50"
            className="text-center"
          >
            {paymentDetails.type === 'partnership' ? 'Partnership Details' : 'Sponsorship Details'}
          </Text>
          
          <VStack gap={3} align="stretch">
            {paymentDetails.type === 'partnership' ? (
              <>
                <Flex justify="space-between" fontSize="sm">
                  <Text fontWeight={"semibold"}>Project</Text>
                  <Text fontWeight="medium" color="gray.500">{paymentDetails.project}</Text>
                </Flex>
                <Flex justify="space-between" fontSize="sm">
                  <Text fontWeight={"semibold"}>Amount</Text>
                  <Text fontWeight="medium" color="gray.500">{paymentDetails.amount} {paymentDetails.frequency}</Text>
                </Flex>
                {paymentDetails.email && (
                  <Flex justify="space-between" fontSize="sm">
                    <Text textAlign={"start"} fontWeight={"semibold"}>Confirmation Email</Text>
                    <Text fontWeight="medium" textAlign={"end"} color="blue.500">Sent to {paymentDetails.email}</Text>
                  </Flex>
                )}
              </>
            ) : (
              <>
                <Flex justify="space-between" fontSize="sm">
                  <Text fontWeight={"semibold"}>Beneficiary's Name</Text>
                  <Text fontWeight="medium" color="gray.500">{paymentDetails.name}</Text>
                </Flex>
                {paymentDetails.location && (
                  <Flex justify="space-between" fontSize="sm">
                    <Text fontWeight={"semibold"}>Location</Text>
                    <Text fontWeight="medium" color="gray.500">{paymentDetails.location}</Text>
                  </Flex>
                )}
                {paymentDetails.email && (
                  <Flex justify="space-between" fontSize="sm">
                    <Text textAlign={"start"} fontWeight={"semibold"}>Confirmation Email</Text>
                    <Text fontWeight="medium" textAlign={"end"} color="blue.500">Sent to {paymentDetails.email}</Text>
                  </Flex>
                )}
              </>
            )}
          </VStack>
        </Box>
        <Text fontSize="sm" color="gray.600" mb={6} className="text-center">
          {paymentDetails.type === 'partnership' ? (
            "You'll receive updates about how your partnership is making a difference in children's lives."
          ) : (
            `You'll receive updates about ${paymentDetails.name}'s progress and how your support is making a difference.`
          )}
        </Text>
        <Button
          onClick={() => router.push(paymentDetails.type === 'partnership' ? '/partnerships' : '/sponsorships')}
          colorScheme="blue"
          size="md"
          width="full"
          borderRadius="md"
          bg="#1C3C8C"
          color={"#F8FAFC"}
          fontWeight={"semibold"}
          _hover={{ bg: "#34495e" }}
        >
          {paymentDetails.type === 'partnership' ? 'Back to Partnerships' : 'Back to Sponsorships'}
        </Button>
      </Box>
    </Center>
  );
};

export default function SuccessPage() {
  return (
    <Suspense fallback={<Center className="min-h-screen"><Spinner size="xl" color="blue.500" /></Center>}>
      <SuccessPageContent />
    </Suspense>
  );
}
