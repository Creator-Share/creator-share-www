import React from 'react'
import { Box, Text } from '@chakra-ui/react'
const ChildActivity = () => {
  return (
    <Box borderWidth="1px" borderRadius={{ base: 'lg', md: 'md' }} p={8}>
        <Text className='text-base font-bold border-b border-gray-200 pb-4'>
            Activities
        </Text>
    </Box>
  )
}

export default ChildActivity