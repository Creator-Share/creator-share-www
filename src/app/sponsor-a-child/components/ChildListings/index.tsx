"use client"
import { Box, VStack } from "@chakra-ui/react";
import React, { useState, useEffect, useCallback } from "react";
import ChildCard from "../ChildCard";
import SponsorDialog from "../SponsorDialog";
import { SponsorPeople } from "@/types";
import { ChildListingsProps } from "@/types/propTypes";

const ChildListings = React.forwardRef<HTMLDivElement, ChildListingsProps>(({
  peopleData,
  selectedChildId,
  selectedCountry,
  setSelectedChildId
}, ref) => {
  const [visiblePeople, setVisiblePeople] = useState<SponsorPeople[]>([]);
  const isInIframe = window.self !== window.top;
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [activeChildId, setActiveChildId] = useState<string | null>(null);
  
  useEffect(() => {
    let filteredPeople = peopleData;

    if (selectedCountry) {
      filteredPeople = peopleData.filter(person => person.country === selectedCountry);
    }

    setVisiblePeople(isInIframe ? filteredPeople : filteredPeople.slice(0, 8));

    if (isInIframe) {
      setTimeout(() => {
        window.parent.postMessage({
          type: 'resize',
          height: document.documentElement.scrollHeight + 200
        }, '*');
      }, 100);
    }
  }, [peopleData, selectedCountry, isInIframe]);

  const handleScroll = useCallback(() => {
    if (isInIframe) return;

    if (
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 500 &&
      visiblePeople.length < peopleData.length
    ) {
      setVisiblePeople(prev => [
        ...prev,
        ...peopleData.slice(prev.length, prev.length + 8)
      ]);
    }
  }, [peopleData, visiblePeople.length, isInIframe]);

  useEffect(() => {
    if (!isInIframe) {
      window.addEventListener("scroll", handleScroll);
      return () => window.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll, isInIframe]);

  // Handle opening the dialog for a specific child
  const handleOpenDialog = (childId: string) => {
    console.log(`ChildListings: Opening dialog for child ID: ${childId}`);
    setActiveChildId(childId);
    setDialogOpen(true);
  };
  
  // Handle dialog navigation
  const handleDialogNavigation = (direction: 'next' | 'previous') => {
    if (!activeChildId) return;
    
    const currentIndex = visiblePeople.findIndex(child => child.id === activeChildId);
    console.log(`ChildListings: handleDialogNavigation called with direction: ${direction}, current index: ${currentIndex}`);
    
    if (direction === 'next' && currentIndex < visiblePeople.length - 1) {
      const nextChild = visiblePeople[currentIndex + 1];
      console.log(`ChildListings: Navigating to next child: ${nextChild.name} (ID: ${nextChild.id})`);
      setActiveChildId(nextChild.id);
      setSelectedChildId(nextChild.id);
      
      // Only scroll to the child if not in an iframe
      if (!isInIframe) {
        document.getElementById(nextChild.id)?.scrollIntoView({ behavior: 'smooth' });
      }
    } else if (direction === 'previous' && currentIndex > 0) {
      const prevChild = visiblePeople[currentIndex - 1];
      console.log(`ChildListings: Navigating to previous child: ${prevChild.name} (ID: ${prevChild.id})`);
      setActiveChildId(prevChild.id);
      setSelectedChildId(prevChild.id);
      
      // Only scroll to the child if not in an iframe
      if (!isInIframe) {
        document.getElementById(prevChild.id)?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  // Get the active child data
  const activeChild = activeChildId 
    ? visiblePeople.find(child => child.id === activeChildId) 
    : null;

  // Get navigation props for the dialog
  const getDialogNavigationProps = () => {
    if (!activeChildId) return { hasNext: false, hasPrevious: false };
    
    const currentIndex = visiblePeople.findIndex(child => child.id === activeChildId);
    return {
      hasNext: currentIndex < visiblePeople.length - 1,
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
      style={{ minHeight: visiblePeople.length ? 'auto' : '100px' }}
      suppressHydrationWarning={true}
    >
      {/* Render the shared dialog */}
      {activeChild && (
        <SponsorDialog
          people={activeChild}
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
        {visiblePeople.map((person) => (
          <Box key={person.id}>
            <ChildCard
              people={person}
              isSelected={selectedChildId === person.id}
              id={person.id}
              onOpenDialog={() => handleOpenDialog(person.id)}
              onNext={person.id === activeChildId ? () => handleDialogNavigation('next') : undefined}
              onPrevious={person.id === activeChildId ? () => handleDialogNavigation('previous') : undefined}
              hasNext={person.id === activeChildId ? getDialogNavigationProps().hasNext : false}
              hasPrevious={person.id === activeChildId ? getDialogNavigationProps().hasPrevious : false}
            />
          </Box>
        ))}
      </VStack>
    </Box>
  );
});

ChildListings.displayName = 'ChildListings';

export default ChildListings;
