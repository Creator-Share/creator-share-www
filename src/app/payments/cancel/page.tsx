"use client";
import { Box, Text } from "@chakra-ui/react";
import GoBackButton from "@/components/ui/goBack";

const CancelPage = () => {

    return (
        <Box className="flex flex-col items-center justify-center h-screen">
            <Text className="text-2xl font-semibold text-red-600">Payment Canceled</Text>
            <GoBackButton />
        </Box>
    );
};

export default CancelPage;
