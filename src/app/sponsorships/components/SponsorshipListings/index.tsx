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
  const itemsPerPage = 6; // Show fewer items per page to test pagination

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

  // Effect to update page when selected beneficiary changes
  useEffect(() => {
    if (!selectedBeneficiaryId) return;

    // Find the index of the selected beneficiary in the filtered list
    const index = filteredBeneficiary.findIndex(b => b.id === selectedBeneficiaryId);

    if (index === -1) return; // Not found in filtered list

    // Calculate the page number that contains the selected beneficiary
    const newPage = Math.floor(index / itemsPerPage) + 1;

    if (newPage !== currentPage) {
      setPageChangeFromSelection(true);
      setCurrentPage(newPage);
    }
  }, [selectedBeneficiaryId, filteredBeneficiary, currentPage, itemsPerPage]);

  // Track if page change was triggered by beneficiary selection
  const [pageChangeFromSelection, setPageChangeFromSelection] = useState(false);

  // Reset selectedBeneficiaryId when currentPage changes to allow manual pagination
  useEffect(() => {
    if (selectedBeneficiaryId && !pageChangeFromSelection) {
      setSelectedBeneficiaryId(null);
    }
    // Don't reset pageChangeFromSelection here to avoid immediate clearing
  }, [currentPage, pageChangeFromSelection, setSelectedBeneficiaryId, selectedBeneficiaryId]);

  // Reset pageChangeFromSelection after a delay to allow the beneficiary to be shown
  useEffect(() => {
    if (pageChangeFromSelection) {
      const timer = setTimeout(() => {
        setPageChangeFromSelection(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [pageChangeFromSelection]);

  // Remove the scroll effect from listings component since it's now handled in the map component

  // Reset active beneficiary when selectedBeneficiaryId is cleared or page changes
  useEffect(() => {
    if (!selectedBeneficiaryId) {
      setActiveBeneficiaryId(null);
    }
  }, [selectedBeneficiaryId]);

  useEffect(() => {
    setActiveBeneficiaryId(null);
  }, [currentPage]);

  // Handle opening the dialog for a specific child
  const handleOpenDialog = (beneficiaryId?: string) => {
    if (!beneficiaryId) return;
    const index = visibleBeneficiary.findIndex(beneficiary => beneficiary.id === beneficiaryId);
    if (index !== -1) {
      setCurrentDialogIndex(index);
      setActiveBeneficiaryId(beneficiaryId);
      setDialogOpen(true);
    }
  };

  const [currentDialogIndex, setCurrentDialogIndex] = useState<number>(0);

  const handleDialogNavigation = (direction: 'next' | 'previous') => {
    let newIndex = currentDialogIndex;

    if (direction === 'next' && newIndex < visibleBeneficiary.length - 1) {
      newIndex = newIndex + 1;
    } else if (direction === 'previous' && newIndex > 0) {
      newIndex = newIndex - 1;
    }

    if (newIndex !== currentDialogIndex) {
      const targetBeneficiary = visibleBeneficiary[newIndex];
      if (targetBeneficiary?.id) {
        setCurrentDialogIndex(newIndex);
        setActiveBeneficiaryId(targetBeneficiary.id);
        setSelectedBeneficiaryId(targetBeneficiary.id);
      }
    }
  };


  // Get navigation props for the dialog
  const getDialogNavigationProps = () => {
    return {
      hasNext: currentDialogIndex < visibleBeneficiary.length - 1,
      hasPrevious: currentDialogIndex > 0,
    };
  };

  // Calculate total pages
  const totalPages = Math.ceil(filteredBeneficiary.length / itemsPerPage);

  return (
    <Box
      ref={ref}
      width="100%"
      className="border bg-white rounded-2xl"
      px={{ base: 3, md: 8 }}
      mt={4}
      style={{ minHeight: visibleBeneficiary.length ? 'auto' : '100px' }}
      suppressHydrationWarning={true}
    >
      <SponsorDialog
        people={visibleBeneficiary[currentDialogIndex] || visibleBeneficiary[0]}
        isOpen={dialogOpen}
        onOpenChange={(open) => setDialogOpen(open)}
        onNext={() => handleDialogNavigation('next')}
        onPrevious={() => handleDialogNavigation('previous')}
        {...getDialogNavigationProps()}
        trigger={<div style={{ display: 'none' }} />}
        beneficiaryType={beneficiaryType}
      />

      <Box pt={10} pb={6}>
        <SimpleGrid columns={{ base: 1, md: 3 }} gap="1.5rem">
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
              onClick={() => {
                setSelectedBeneficiaryId(null);
                setCurrentPage(prev => Math.max(1, prev - 1));
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
              <Button
                key={page}
                onClick={() => {
                  setSelectedBeneficiaryId(null);
                  setCurrentPage(page);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                colorScheme={currentPage === page ? "blue" : undefined}
                variant={currentPage === page ? "solid" : "outline"}
                aria-current={currentPage === page ? "page" : undefined}
                fontWeight={currentPage === page ? "bold" : "normal"}
              >
                {page}
              </Button>
            ))}
            <Button
              onClick={() => {
                setSelectedBeneficiaryId(null);
                setCurrentPage(prev => Math.min(totalPages, prev + 1));
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
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
