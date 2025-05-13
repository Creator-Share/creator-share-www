"use client"
import { Box, VStack } from "@chakra-ui/react";
import React, { useState, useEffect, useCallback } from "react";
import ChildCard from "../ChildCard";
import SponsorDialog from "../SponsorDialog";
import { ChildSponsorship } from "@/types";
import { ChildListingsProps } from "@/types/propTypes";

const ChildListings = React.forwardRef<HTMLDivElement, ChildListingsProps>(({
  childrenData,
  selectedChildId,
  selectedCountry,
  setSelectedChildId
}, ref) => {
  const [visibleChildren, setVisibleChildren] = useState<ChildSponsorship[]>([]);
  const isInIframe = window.self !== window.top;
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [activeChildId, setActiveChildId] = useState<string | null>(null);
  
  useEffect(() => {
    let filteredChildren = childrenData;

    if (selectedCountry) {
      filteredChildren = childrenData.filter(child => child.country === selectedCountry);
    }

    setVisibleChildren(isInIframe ? filteredChildren : filteredChildren.slice(0, 8));

    if (isInIframe) {
      setTimeout(() => {
        window.parent.postMessage({
          type: 'resize',
          height: document.documentElement.scrollHeight + 200
        }, '*');
      }, 100);
    }
  }, [childrenData, selectedCountry, isInIframe]);

  const handleScroll = useCallback(() => {
    if (isInIframe) return;

    if (
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 500 &&
      visibleChildren.length < childrenData.length
    ) {
      setVisibleChildren(prev => [
        ...prev,
        ...childrenData.slice(prev.length, prev.length + 8)
      ]);
    }
  }, [childrenData, visibleChildren.length, isInIframe]);

  useEffect(() => {
    if (!isInIframe) {
      window.addEventListener("scroll", handleScroll);
      return () => window.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll, isInIframe]);

  const handleOpenDialog = (childId: string) => {
    console.log(`ChildListings: Opening dialog for child ID: ${childId}`);
    setActiveChildId(childId);
    setDialogOpen(true);
  };

  const handleDialogNavigation = (direction: 'next' | 'previous') => {
    if (!activeChildId) return;
    
    const currentIndex = visibleChildren.findIndex(child => child.id === activeChildId);
    console.log(`ChildListings: handleDialogNavigation called with direction: ${direction}, current index: ${currentIndex}`);
    
    if (direction === 'next' && currentIndex < visibleChildren.length - 1) {
      const nextChild = visibleChildren[currentIndex + 1];
      console.log(`ChildListings: Navigating to next child: ${nextChild.name} (ID: ${nextChild.id})`);
      setActiveChildId(nextChild.id);
      setSelectedChildId(nextChild.id);

      if (!isInIframe) {
        document.getElementById(nextChild.id)?.scrollIntoView({ behavior: 'smooth' });
      }
    } else if (direction === 'previous' && currentIndex > 0) {
      const prevChild = visibleChildren[currentIndex - 1];
      console.log(`ChildListings: Navigating to previous child: ${prevChild.name} (ID: ${prevChild.id})`);
      setActiveChildId(prevChild.id);
      setSelectedChildId(prevChild.id);
      
      if (!isInIframe) {
        document.getElementById(prevChild.id)?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  const activeChild = activeChildId 
    ? visibleChildren.find(child => child.id === activeChildId) 
    : null;

  const getDialogNavigationProps = () => {
    if (!activeChildId) return { hasNext: false, hasPrevious: false };
    
    const currentIndex = visibleChildren.findIndex(child => child.id === activeChildId);
    return {
      hasNext: currentIndex < visibleChildren.length - 1,
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
      style={{ minHeight: visibleChildren.length ? 'auto' : '100px' }}
      suppressHydrationWarning={true}
    >
      {/* Render the shared dialog */}
      {activeChild && (
        <SponsorDialog
          child={activeChild}
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
        {visibleChildren.map((child) => (
          <Box key={child.id}>
            <ChildCard
              child={child}
              isSelected={selectedChildId === child.id}
              id={child.id}
              onOpenDialog={() => handleOpenDialog(child.id)}
              onNext={child.id === activeChildId ? () => handleDialogNavigation('next') : undefined}
              onPrevious={child.id === activeChildId ? () => handleDialogNavigation('previous') : undefined}
              hasNext={child.id === activeChildId ? getDialogNavigationProps().hasNext : false}
              hasPrevious={child.id === activeChildId ? getDialogNavigationProps().hasPrevious : false}
            />
          </Box>
        ))}
      </VStack>
    </Box>
  );
});

ChildListings.displayName = 'ChildListings';

export default ChildListings;
