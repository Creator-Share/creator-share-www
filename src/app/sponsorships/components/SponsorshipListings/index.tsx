"use client"
import { Box, VStack } from "@chakra-ui/react";
import React, { useState, useEffect, useCallback } from "react";
import BeneficiaryCard from "../SponsorshipCard";
import SponsorDialog from "../SponsorDialog";
import { Beneficiaries } from "@/types";
import { BeneficiaryListingsProps } from "@/types/propTypes";

const BeneficiaryListings = React.forwardRef<HTMLDivElement, BeneficiaryListingsProps>(({
  beneficiaryData,
  selectedBeneficiaryId,
  selectedCountry,
  setSelectedBeneficiaryId
}, ref) => {
  const [visibleBeneficiary, setVisibleBeneficiary] = useState<Beneficiaries[]>([]);
  const isInIframe = window.self !== window.top;
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [activeBeneficiaryId, setActiveBeneficiaryId] = useState<string | null>(null);
  
  useEffect(() => {
    const safeBeneficiaryData = Array.isArray(beneficiaryData) ? beneficiaryData : [];
    let filteredBeneficiary = safeBeneficiaryData;

    if (selectedCountry) {
      filteredBeneficiary = safeBeneficiaryData.filter(beneficiary => beneficiary.country === selectedCountry);
    }

    setVisibleBeneficiary(isInIframe ? filteredBeneficiary : filteredBeneficiary.slice(0, 8));

    if (isInIframe) {
      setTimeout(() => {
        window.parent.postMessage({
          type: 'resize',
          height: document.documentElement.scrollHeight + 200
        }, '*');
      }, 100);
    }
  }, [beneficiaryData, selectedCountry, isInIframe]);

  const handleScroll = useCallback(() => {
    if (isInIframe) return;

    const safeBeneficiaryData = Array.isArray(beneficiaryData) ? beneficiaryData : [];

    if (
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 500 &&
      visibleBeneficiary.length < safeBeneficiaryData.length
    ) {
      setVisibleBeneficiary(prev => [
        ...prev,
        ...safeBeneficiaryData.slice(prev.length, prev.length + 8)
      ]);
    }
  }, [beneficiaryData, visibleBeneficiary.length, isInIframe]);

  useEffect(() => {
    if (!isInIframe) {
      window.addEventListener("scroll", handleScroll);
      return () => window.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll, isInIframe]);

  // Handle opening the dialog for a specific child
  const handleOpenDialog = (beneficiaryId?: string) => {
    if (!beneficiaryId) return;
    console.log(`BeneficiaryListings: Opening dialog for beneficiary ID: ${beneficiaryId}`);
    setActiveBeneficiaryId(beneficiaryId);
    setDialogOpen(true);
  };
  
  // Handle dialog navigation
  const handleDialogNavigation = (direction: 'next' | 'previous') => {
    if (!activeBeneficiaryId) return;
    
    const currentIndex = visibleBeneficiary.findIndex(beneficiary => beneficiary.id === activeBeneficiaryId);
    console.log(`ChildListings: handleDialogNavigation called with direction: ${direction}, current index: ${currentIndex}`);
    
    if (direction === 'next' && currentIndex < visibleBeneficiary.length - 1) {
      const nextBeneficiary = visibleBeneficiary[currentIndex + 1];
      if (nextBeneficiary.id) {
        console.log(`ChildListings: Navigating to next child: ${nextBeneficiary.name} (ID: ${nextBeneficiary.id})`);
        setActiveBeneficiaryId(nextBeneficiary.id);
        setSelectedBeneficiaryId(nextBeneficiary.id);
        // Only scroll to the child if not in an iframe
        if (!isInIframe) {
          document.getElementById(nextBeneficiary.id)?.scrollIntoView({ behavior: 'smooth' });
        }
      }
    } else if (direction === 'previous' && currentIndex > 0) {
      const prevBeneficiary = visibleBeneficiary[currentIndex - 1];
      if (prevBeneficiary.id) {
        console.log(`BeneficiaryListings: Navigating to previous beneficiary: ${prevBeneficiary.name} (ID: ${prevBeneficiary.id})`);
        setActiveBeneficiaryId(prevBeneficiary.id);
        setSelectedBeneficiaryId(prevBeneficiary.id);
        // Only scroll to the child if not in an iframe
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
      {/* Render the shared dialog */}
      {activeBeneficiary && (
        <SponsorDialog
          people={activeBeneficiary}
          isOpen={dialogOpen}
          onOpenChange={(open) => setDialogOpen(open)}
          onNext={() => handleDialogNavigation('next')}
          onPrevious={() => handleDialogNavigation('previous')}
          {...getDialogNavigationProps()}
          trigger={<div style={{ display: 'none' }} />} // Hidden trigger as we're controlling the dialog open state
        />
      )}
      
      <VStack 
        align="stretch" 
        pt={10}
        pb={10}
        gap="1.5rem"
      >
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
              />
            </Box>
          ) : null
        )}
      </VStack>
    </Box>
  );
});

BeneficiaryListings.displayName = 'BeneficiaryListings';

export default BeneficiaryListings;
