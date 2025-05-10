"use client";
import { Box, VStack } from "@chakra-ui/react";
import React, { useState, useEffect, useCallback } from "react";
import FamilyCard from "../FamilyCard";
import SponsorDialog from "../SponsorDialog";
import { SponsorPeople } from "@/types";

interface FamilyListingsProps {
  peopleData: SponsorPeople[];
  selectedFamilyId: string | null;
  selectedCountry: string | null;
  setSelectedFamilyId: (id: string | null) => void;
}

const FamilyListings = React.forwardRef<HTMLDivElement, FamilyListingsProps>(
  ({ peopleData, selectedFamilyId, selectedCountry, setSelectedFamilyId }, ref) => {
    const [visibleFamilies, setVisibleFamilies] = useState<SponsorPeople[]>([]);
    const isInIframe = window.self !== window.top;
    const [dialogOpen, setDialogOpen] = useState<boolean>(false);
    const [activeFamilyId, setActiveFamilyId] = useState<string | null>(null);

    useEffect(() => {
      let filteredFamilies = peopleData;

      if (selectedCountry) {
        filteredFamilies = peopleData.filter(
          (family) => family.country === selectedCountry
        );
      }

      setVisibleFamilies(
        isInIframe ? filteredFamilies : filteredFamilies.slice(0, 8)
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
        visibleFamilies.length < peopleData.length
      ) {
        setVisibleFamilies((prev) => [
          ...prev,
          ...peopleData.slice(prev.length, prev.length + 8),
        ]);
      }
    }, [peopleData, visibleFamilies.length, isInIframe]);

    useEffect(() => {
      if (!isInIframe) {
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
      }
    }, [handleScroll, isInIframe]);

    const handleOpenDialog = (familyId: string) => {
      console.log(`FamilyListings: Opening dialog for family ID: ${familyId}`);
      setActiveFamilyId(familyId);
      setDialogOpen(true);
    };

    const handleDialogNavigation = (direction: "next" | "previous") => {
      if (!activeFamilyId) return;

      const currentIndex = visibleFamilies.findIndex(
        (family) => family.id === activeFamilyId
      );
      console.log(
        `FamilyListings: handleDialogNavigation called with direction: ${direction}, current index: ${currentIndex}`
      );

      if (direction === "next" && currentIndex < visibleFamilies.length - 1) {
        const nextFamily = visibleFamilies[currentIndex + 1];
        console.log(
          `FamilyListings: Navigating to next family: ${nextFamily.name} (ID: ${nextFamily.id})`
        );
        setActiveFamilyId(nextFamily.id);
        setSelectedFamilyId(nextFamily.id);

        if (!isInIframe) {
          document
            .getElementById(nextFamily.id)
            ?.scrollIntoView({ behavior: "smooth" });
        }
      } else if (direction === "previous" && currentIndex > 0) {
        const prevFamily = visibleFamilies[currentIndex - 1];
        console.log(
          `FamilyListings: Navigating to previous family: ${prevFamily.name} (ID: ${prevFamily.id})`
        );
        setActiveFamilyId(prevFamily.id);
        setSelectedFamilyId(prevFamily.id);

        if (!isInIframe) {
          document
            .getElementById(prevFamily.id)
            ?.scrollIntoView({ behavior: "smooth" });
        }
      }
    };

    const activeFamily = activeFamilyId
      ? visibleFamilies.find((family) => family.id === activeFamilyId)
      : null;

    const getDialogNavigationProps = () => {
      if (!activeFamilyId) return { hasNext: false, hasPrevious: false };

      const currentIndex = visibleFamilies.findIndex(
        (family) => family.id === activeFamilyId
      );
      return {
        hasNext: currentIndex < visibleFamilies.length - 1,
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
        style={{ minHeight: visibleFamilies.length ? "auto" : "100px" }}
        suppressHydrationWarning={true}
      >
        {activeFamily && (
          <SponsorDialog
            people={activeFamily}
            isOpen={dialogOpen}
            onOpenChange={(details) => setDialogOpen(details.open)}
            onNext={() => handleDialogNavigation("next")}
            onPrevious={() => handleDialogNavigation("previous")}
            {...getDialogNavigationProps()}
            trigger={<div style={{ display: "none" }} />}
          />
        )}

        <VStack align="stretch" pt={10} pb={10} gap="1.5rem">
          {visibleFamilies.map((family) => (
            <Box key={family.id}>
              <FamilyCard
                people={family}
                isSelected={selectedFamilyId === family.id}
                id={family.id}
                onOpenDialog={() => handleOpenDialog(family.id)}
                onNext={
                  family.id === activeFamilyId
                    ? () => handleDialogNavigation("next")
                    : undefined
                }
                onPrevious={
                  family.id === activeFamilyId
                    ? () => handleDialogNavigation("previous")
                    : undefined
                }
                hasNext={
                  family.id === activeFamilyId
                    ? getDialogNavigationProps().hasNext
                    : false
                }
                hasPrevious={
                  family.id === activeFamilyId
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

FamilyListings.displayName = "FamilyListings";

export default FamilyListings;
