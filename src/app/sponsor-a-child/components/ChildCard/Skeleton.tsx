import { Box, Flex, Skeleton } from "@chakra-ui/react";

export const ChildCardSkeleton = () => {
  return (
    <Flex
      direction={{ base: "column", md: "row" }}
      align={{ base: "center", md: "flex-start" }}
      borderRadius={{ base: 'md', md: 'md' }}
      className="bg-white mb-6 p-0 border-0 md:border md:mb-0 md:p-0"
    >
      <Skeleton
        className="mb-4 md:mb-0 rounded-t-md h-[400px] w-[550px] md:rounded-l-md md:rounded-t-none md:h-[273px] md:w-[450px]"
      />
      <Box className="md:grid md:grid-cols-2 pt-[20px] w-full md:w-screen">
        <Box ml={{ md: 6 }} w="full">
          <Skeleton height="2.5rem" width="200px" mb={2} />
          <Box className="text-[#767070] bg-[#DFDFDF] rounded-xl md:bg-white p-4 mb-4">
            <Skeleton height="1rem" mb={4} />
            <Skeleton height="1rem" mb={4} />
            <Skeleton height="1rem" />
          </Box>
        </Box>
      </Box>
    </Flex>
  );
}; 