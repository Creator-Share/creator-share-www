import { Box, Skeleton } from "@chakra-ui/react"

export const BeneficiaryCardSkeleton = () => {
  return (
    <Box className="bg-white rounded-lg border p-0 overflow-hidden">
      {/* Image placeholder */}
      <Skeleton height="200px" width="100%" className="rounded-t-lg" />

      {/* Content area */}
      <Box p={4}>
        {/* Name placeholder */}
        <Skeleton height="1.5rem" width="80%" mb={3} />

        {/* Info icons row */}
        <Box display="flex" gap={4} mb={3}>
          <Skeleton height="1rem" width="60px" />
          <Skeleton height="1rem" width="50px" />
          <Skeleton height="1rem" width="80px" />
        </Box>

        {/* Info text */}
        <Box mb={4}>
          <Skeleton height="1rem" width="40px" mb={2} />
          <Skeleton height="1rem" width="100%" mb={2} />
          <Skeleton height="1rem" width="90%" mb={2} />
          <Skeleton height="1rem" width="70%" />
        </Box>

        {/* Sponsor button */}
        <Skeleton height="2.5rem" width="100%" className="rounded-md" />
      </Box>
    </Box>
  )
}
