"use client"
import React from 'react'
import { Box, Button, VStack } from '@chakra-ui/react';
import { useRouter } from 'next/navigation';

const DashboardOptions = () => {
    const router = useRouter();
    const handleNavigateAdmin = () => {
        router.push('/admin-panel')
    }
    const handleNavigateUser = () => {
        router.push('/')
    }
    return (
        <Box className="flex items-center justify-center min-h-screen">
            <Box className="w-full max-w-md p-6 bg-[#FFFFFF] md:rounded-lg md:border md:shadow-sm md:px-8 md:py-12">
                <VStack>
                    <Button onClick={handleNavigateAdmin} className="border bg-[#1C3C8C] text-[#FFFFFF] font-semibold text-base w-full">
                        Admin Dashboard
                    </Button>
                    <Button onClick={handleNavigateUser} className="border border-[#1C3C8C] text-[#1C3C8C] text-base font-semibold w-full">
                        Users Dashboard
                    </Button>
                </VStack>

            </Box>
        </Box>
    )
}

export default DashboardOptions