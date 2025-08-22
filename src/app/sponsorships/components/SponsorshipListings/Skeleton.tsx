import { Box, SimpleGrid } from "@chakra-ui/react";
import { BeneficiaryCardSkeleton } from "../SponsorshipCard/Skeleton";

export const ChildListingsSkeleton = () => {
  return (
    <Box 
      width="100%" 
      className="border bg-white rounded-2xl" 
      px={{ base: 3, md: 8 }} 
      mt={4}
      suppressHydrationWarning={true}
    >
      <Box pt={10} pb={6}>
        <SimpleGrid columns={{ base: 1, md: 3 }} gap="1.5rem" className="w-full">
          {[1, 2, 3, 4, 5, 6].map((index) => (
            <Box key={index}>
              <BeneficiaryCardSkeleton />
            </Box>
          ))}
        </SimpleGrid>
      </Box>
    </Box>
  );
}; 