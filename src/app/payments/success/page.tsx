"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Box, Text, Spinner } from "@chakra-ui/react";

const SuccessPage = () => {
  const router = useRouter();

  useEffect(() => {
    console.log("Payment successful!");

    // Redirect after 3 seconds
    const timeout = setTimeout(() => {
      const peopleId = localStorage.getItem("sponsoredChildId");
      if (peopleId) {
        router.push(`/sponsor-a-child/${peopleId}`);
      } else {
        router.push("/sponsor-a-child");
      }
    }, 3000);

    return () => clearTimeout(timeout);
  }, [router]);

  return (
    <Box className="flex flex-col items-center justify-center h-screen">
      <Text className="text-2xl font-semibold text-green-600">Payment Successful!</Text>
      <Spinner size="lg" mt={4} />
      <Text mt={2} className="text-gray-600">
        Redirecting...
      </Text>
    </Box>
  );
};

export default SuccessPage;
