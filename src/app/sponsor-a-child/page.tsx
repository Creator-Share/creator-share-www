"use client"
import React from 'react'
import { Box } from '@chakra-ui/react'
import Filters from '@/app/sponsor-a-child/components/Filters'
import ChildListing from './components/ChildCard';

interface Filters {
    location: string;
    gender: string;
}

const SponsorChild = () => {

  const handleFiltersChange = (filters: Filters) => {
    console.log("Applied Filters:", filters);
  };
  return (
    <Box className='flex flex-col items-center justify-center' px={32} py={16}>
      <Filters onFilterChange={handleFiltersChange} />
      <ChildListing />
    </Box>
  )
}

export default SponsorChild