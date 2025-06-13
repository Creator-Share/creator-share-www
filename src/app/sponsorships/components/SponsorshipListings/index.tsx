"use client"
import { Box, Flex, Button, SimpleGrid } from "@chakra-ui/react";
import React, { useState, useEffect } from "react";
import BeneficiaryCard from "../SponsorshipCard";
import SponsorDialog from "../SponsorDialog";
import { BeneficiaryListingsProps } from "@/types/propTypes";

const BeneficiaryListings = React.forwardRef<HTMLDivElement, BeneficiaryListingsProps>(({
  beneficiaryData,
  selectedBeneficiaryId,
  selectedCountry,
  setSelectedBeneficiaryId,
  mapBounds,
  beneficiaryType = "CHILD"
}, ref) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [activeBeneficiaryId, setActiveBeneficiaryId] = useState<string | null>(null);
  const isInIframe = window.self !== window.top;
  const itemsPerPage = 4; // Show fewer items per page to test pagination

  const filteredBeneficiary = React.useMemo(() => {
    const safeBeneficiaryData = Array.isArray(beneficiaryData) ? beneficiaryData : [];

    const filtered = safeBeneficiaryData.filter(beneficiary => {
      // Filter by country if selected
      if (selectedCountry && beneficiary.country !== selectedCountry) {
        return false;
      }

      if (mapBounds) {
        if (beneficiary.location_geo) {
          const [lng, lat] = beneficiary.location_geo.coordinates;
          return mapBounds.contains([lat, lng]);
        } else {
          // Include animals with null location_geo in the listings
          return true;
        }
      }

      return true;
    });

    return filtered;
  }, [beneficiaryData, selectedCountry, mapBounds]);

  const visibleBeneficiary = React.useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const sliced = filteredBeneficiary.slice(startIndex, endIndex);

    return sliced;
  }, [filteredBeneficiary, currentPage, itemsPerPage]);

  useEffect(() => {
    if (isInIframe) {
      setTimeout(() => {
        window.parent.postMessage({
          type: 'resize',
          height: document.documentElement.scrollHeight + 200
        }, '*');
      }, 100);
    }
  }, [isInIframe]);

  useEffect(() => {
    setCurrentPage(1); // Reset to first page when country or map bounds change
  }, [selectedCountry, mapBounds]);

  // Handle opening the dialog for a specific child
  const handleOpenDialog = (beneficiaryId?: string) => {
    if (!beneficiaryId) return;
    setActiveBeneficiaryId(beneficiaryId);
    setDialogOpen(true);
  };

  const handleDialogNavigation = (direction: 'next' | 'previous') => {
    if (!activeBeneficiaryId) return;

    const currentIndex = visibleBeneficiary.findIndex(beneficiary => beneficiary.id === activeBeneficiaryId);

    if (direction === 'next' && currentIndex < visibleBeneficiary.length - 1) {
      const nextBeneficiary = visibleBeneficiary[currentIndex + 1];
      if (nextBeneficiary.id) {
        setActiveBeneficiaryId(nextBeneficiary.id);
        setSelectedBeneficiaryId(nextBeneficiary.id);
        if (!isInIframe) {
          document.getElementById(nextBeneficiary.id)?.scrollIntoView({ behavior: 'smooth' });
        }
      }
    } else if (direction === 'previous' && currentIndex > 0) {
      const prevBeneficiary = visibleBeneficiary[currentIndex - 1];
      if (prevBeneficiary.id) {
        setActiveBeneficiaryId(prevBeneficiary.id);
        setSelectedBeneficiaryId(prevBeneficiary.id);
        if (!isInIframe) {
          document.getElementById(prevBeneficiary.id)?.scrollIntoView({ behavior: 'smooth' });
        }
      }
    }
  };

  // Get the active child data
  const activeBeneficiary = activeBeneficiaryId
    ? visibleBeneficiary.find(beneficiary => beneficiary.id === activeBeneficiaryId)
    : null;

  // Get navigation props for the dialog
  const getDialogNavigationProps = () => {
    if (!activeBeneficiaryId) return { hasNext: false, hasPrevious: false };

    const currentIndex = visibleBeneficiary.findIndex(beneficiary => beneficiary.id === activeBeneficiaryId);
    return {
      hasNext: currentIndex < visibleBeneficiary.length - 1,
      hasPrevious: currentIndex > 0,
    };
  };

  // Calculate total pages
  const totalPages = Math.ceil(filteredBeneficiary.length / itemsPerPage);

  return (
    <Box
      ref={ref}
      width="100%"
      className="border bg-white rounded-xl"
      px={{ base: 3, md: 8 }}
      mt={4}
      style={{ minHeight: visibleBeneficiary.length ? 'auto' : '100px' }}
      suppressHydrationWarning={true}
    >
      {activeBeneficiary && (
        <SponsorDialog
          people={activeBeneficiary}
          isOpen={dialogOpen}
          onOpenChange={(open) => setDialogOpen(open)}
          onNext={() => handleDialogNavigation('next')}
          onPrevious={() => handleDialogNavigation('previous')}
          {...getDialogNavigationProps()}
          trigger={<div style={{ display: 'none' }} />}
          beneficiaryType={beneficiaryType}
        />
      )}

      <Box pt={10} pb={6}>
        <SimpleGrid columns={{ base: 1, md: 1 }} gap="1.5rem">
          {visibleBeneficiary.map((beneficiary) =>
            beneficiary.id ? (
              <Box key={beneficiary.id}>
                <BeneficiaryCard
                  beneficiary={beneficiary}
                  isSelected={selectedBeneficiaryId === beneficiary.id}
                  id={beneficiary.id}
                  onOpenDialog={() => handleOpenDialog(beneficiary.id)}
                  onNext={beneficiary.id === activeBeneficiaryId ? () => handleDialogNavigation('next') : undefined}
                  onPrevious={beneficiary.id === activeBeneficiaryId ? () => handleDialogNavigation('previous') : undefined}
                  hasNext={beneficiary.id === activeBeneficiaryId ? getDialogNavigationProps().hasNext : false}
                  hasPrevious={beneficiary.id === activeBeneficiaryId ? getDialogNavigationProps().hasPrevious : false}
                  beneficiaryType={beneficiaryType}
                />
              </Box>
            ) : null
          )}
        </SimpleGrid>
      </Box>
      {filteredBeneficiary.length > itemsPerPage && (
        <Flex justify="center" pb={10} gap={2}>
          <Flex gap={2}>
            <Button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
              <Button
                key={page}
                onClick={() => setCurrentPage(page)}
                colorScheme={currentPage === page ? "blue" : undefined}
                variant={currentPage === page ? "solid" : "outline"}
                aria-current={currentPage === page ? "page" : undefined}
                fontWeight={currentPage === page ? "bold" : "normal"}
              >
                {page}
              </Button>
            ))}
            <Button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </Flex>
        </Flex>
      )}
    </Box>
  );
});

BeneficiaryListings.displayName = 'BeneficiaryListings';

export default BeneficiaryListings;
