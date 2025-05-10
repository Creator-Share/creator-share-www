"use client";
import { Box, VStack } from "@chakra-ui/react";
import React, { useState, useEffect, useCallback } from "react";
import PuppyCard from "../PuppyCard";
import SponsorDialog from "../SponsorDialog";
import { SponsorPeople } from "@/types";

interface PuppyListingsProps {
  peopleData: SponsorPeople[];
  selectedPuppyId: string | null;
  selectedCountry: string | null;
  setSelectedPuppyId: (id: string | null) => void;
}

const PuppyListings = React.forwardRef<HTMLDivElement, PuppyListingsProps>(
  ({ peopleData, selectedPuppyId, selectedCountry, setSelectedPuppyId }, ref) => {
    const [visiblePuppies, setVisiblePuppies] = useState<SponsorPeople[]>([]);
    const isInIframe = window.self !== window.top;
    const [dialogOpen, setDialogOpen] = useState<boolean>(false);
    const [activePuppyId, setActivePuppyId] = useState<string | null>(null);

    useEffect(() => {
      let filteredPuppies = peopleData;

      if (selectedCountry) {
        filteredPuppies = peopleData.filter(
          (puppy) => puppy.country === selectedCountry
        );
      }

      setVisiblePuppies(
        isInIframe ? filteredPuppies : filteredPuppies.slice(0, 8)
      );

      if (isInIframe) {
        setTimeout(() => {
          window.parent.postMessage(
            {
              type: "resize",
              height: document.documentElement.scrollHeight + 200,
            },
            "*"
          );
        }, 100);
      }
    }, [peopleData, selectedCountry, isInIframe]);

    const handleScroll = useCallback(() => {
      if (isInIframe) return;

      if (
        window.innerHeight + window.scrollY >=
          document.documentElement.scrollHeight - 500 &&
        visiblePuppies.length < peopleData.length
      ) {
        setVisiblePuppies((prev) => [
          ...prev,
          ...peopleData.slice(prev.length, prev.length + 8),
        ]);
      }
    }, [peopleData, visiblePuppies.length, isInIframe]);

    useEffect(() => {
      if (!isInIframe) {
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
      }
    }, [handleScroll, isInIframe]);

    const handleOpenDialog = (puppyId: string) => {
      console.log(`PuppyListings: Opening dialog for puppy ID: ${puppyId}`);
      setActivePuppyId(puppyId);
      setDialogOpen(true);
    };

    const handleDialogNavigation = (direction: "next" | "previous") => {
      if (!activePuppyId) return;

      const currentIndex = visiblePuppies.findIndex(
        (puppy) => puppy.id === activePuppyId
      );
      console.log(
        `PuppyListings: handleDialogNavigation called with direction: ${direction}, current index: ${currentIndex}`
      );

      if (direction === "next" && currentIndex < visiblePuppies.length - 1) {
        const nextPuppy = visiblePuppies[currentIndex + 1];
        console.log(
          `PuppyListings: Navigating to next puppy: ${nextPuppy.name} (ID: ${nextPuppy.id})`
        );
        setActivePuppyId(nextPuppy.id);
        setSelectedPuppyId(nextPuppy.id);

        if (!isInIframe) {
          document
            .getElementById(nextPuppy.id)
            ?.scrollIntoView({ behavior: "smooth" });
        }
      } else if (direction === "previous" && currentIndex > 0) {
        const prevPuppy = visiblePuppies[currentIndex - 1];
        console.log(
          `PuppyListings: Navigating to previous puppy: ${prevPuppy.name} (ID: ${prevPuppy.id})`
        );
        setActivePuppyId(prevPuppy.id);
        setSelectedPuppyId(prevPuppy.id);

        if (!isInIframe) {
          document
            .getElementById(prevPuppy.id)
            ?.scrollIntoView({ behavior: "smooth" });
        }
      }
    };

    const activePuppy = activePuppyId
      ? visiblePuppies.find((puppy) => puppy.id === activePuppyId)
      : null;

    const getDialogNavigationProps = () => {
      if (!activePuppyId) return { hasNext: false, hasPrevious: false };

      const currentIndex = visiblePuppies.findIndex(
        (puppy) => puppy.id === activePuppyId
      );
      return {
        hasNext: currentIndex < visiblePuppies.length - 1,
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
        style={{ minHeight: visiblePuppies.length ? "auto" : "100px" }}
        suppressHydrationWarning={true}
      >
        {activePuppy && (
          <SponsorDialog
            people={activePuppy}
            isOpen={dialogOpen}
            onOpenChange={(details) => setDialogOpen(details.open)}
            onNext={() => handleDialogNavigation("next")}
            onPrevious={() => handleDialogNavigation("previous")}
            {...getDialogNavigationProps()}
            trigger={<div style={{ display: "none" }} />}
          />
        )}

        <VStack align="stretch" pt={10} pb={10} gap="1.5rem">
          {visiblePuppies.map((puppy) => (
            <Box key={puppy.id}>
              <PuppyCard
                people={puppy}
                isSelected={selectedPuppyId === puppy.id}
                id={puppy.id}
                onOpenDialog={() => handleOpenDialog(puppy.id)}
                onNext={
                  puppy.id === activePuppyId
                    ? () => handleDialogNavigation("next")
                    : undefined
                }
                onPrevious={
                  puppy.id === activePuppyId
                    ? () => handleDialogNavigation("previous")
                    : undefined
                }
                hasNext={
                  puppy.id === activePuppyId
                    ? getDialogNavigationProps().hasNext
                    : false
                }
                hasPrevious={
                  puppy.id === activePuppyId
                    ? getDialogNavigationProps().hasPrevious
                    : false
                }
              />
            </Box>
          ))}
        </VStack>
      </Box>
    );
  }
);

PuppyListings.displayName = "PuppyListings";

export default PuppyListings;
