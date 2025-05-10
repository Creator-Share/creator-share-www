"use client";
import { Box, VStack } from "@chakra-ui/react";
import React, { useState, useEffect, useCallback } from "react";
import StreetChildCard from "../StreetChildCard";
import SponsorDialog from "../SponsorDialog";
import { SponsorPeople } from "@/types";

interface StreetChildListingsProps {
  peopleData: SponsorPeople[];
  selectedChildId: string | null;
  selectedCountry: string | null;
  setSelectedChildId: (id: string | null) => void;
}

const StreetChildListings = React.forwardRef<HTMLDivElement, StreetChildListingsProps>(
  ({ peopleData, selectedChildId, selectedCountry, setSelectedChildId }, ref) => {
    const [visibleChildren, setVisibleChildren] = useState<SponsorPeople[]>([]);
    const isInIframe = window.self !== window.top;
    const [dialogOpen, setDialogOpen] = useState<boolean>(false);
    const [activeChildId, setActiveChildId] = useState<string | null>(null);

    useEffect(() => {
      let filteredChildren = peopleData;

      if (selectedCountry) {
        filteredChildren = peopleData.filter(
          (child) => child.country === selectedCountry
        );
      }

      setVisibleChildren(
        isInIframe ? filteredChildren : filteredChildren.slice(0, 8)
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
        visibleChildren.length < peopleData.length
      ) {
        setVisibleChildren((prev) => [
          ...prev,
          ...peopleData.slice(prev.length, prev.length + 8),
        ]);
      }
    }, [peopleData, visibleChildren.length, isInIframe]);

    useEffect(() => {
      if (!isInIframe) {
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
      }
    }, [handleScroll, isInIframe]);

    const handleOpenDialog = (childId: string) => {
      console.log(`StreetChildListings: Opening dialog for child ID: ${childId}`);
      setActiveChildId(childId);
      setDialogOpen(true);
    };

    const handleDialogNavigation = (direction: "next" | "previous") => {
      if (!activeChildId) return;

      const currentIndex = visibleChildren.findIndex(
        (child) => child.id === activeChildId
      );
      console.log(
        `StreetChildListings: handleDialogNavigation called with direction: ${direction}, current index: ${currentIndex}`
      );

      if (direction === "next" && currentIndex < visibleChildren.length - 1) {
        const nextChild = visibleChildren[currentIndex + 1];
        console.log(
          `StreetChildListings: Navigating to next child: ${nextChild.name} (ID: ${nextChild.id})`
        );
        setActiveChildId(nextChild.id);
        setSelectedChildId(nextChild.id);

        if (!isInIframe) {
          document
            .getElementById(nextChild.id)
            ?.scrollIntoView({ behavior: "smooth" });
        }
      } else if (direction === "previous" && currentIndex > 0) {
        const prevChild = visibleChildren[currentIndex - 1];
        console.log(
          `StreetChildListings: Navigating to previous child: ${prevChild.name} (ID: ${prevChild.id})`
        );
        setActiveChildId(prevChild.id);
        setSelectedChildId(prevChild.id);

        if (!isInIframe) {
          document
            .getElementById(prevChild.id)
            ?.scrollIntoView({ behavior: "smooth" });
        }
      }
    };

    const activeChild = activeChildId
      ? visibleChildren.find((child) => child.id === activeChildId)
      : null;

    const getDialogNavigationProps = () => {
      if (!activeChildId) return { hasNext: false, hasPrevious: false };

      const currentIndex = visibleChildren.findIndex(
        (child) => child.id === activeChildId
      );
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
        style={{ minHeight: visibleChildren.length ? "auto" : "100px" }}
        suppressHydrationWarning={true}
      >
        {activeChild && (
          <SponsorDialog
            people={activeChild}
            isOpen={dialogOpen}
            onOpenChange={(details) => setDialogOpen(details.open)}
            onNext={() => handleDialogNavigation("next")}
            onPrevious={() => handleDialogNavigation("previous")}
            {...getDialogNavigationProps()}
            trigger={<div style={{ display: "none" }} />}
          />
        )}

        <VStack align="stretch" pt={10} pb={10} gap="1.5rem">
          {visibleChildren.map((child) => (
            <Box key={child.id}>
              <StreetChildCard
                people={child}
                isSelected={selectedChildId === child.id}
                id={child.id}
                onOpenDialog={() => handleOpenDialog(child.id)}
                onNext={
                  child.id === activeChildId
                    ? () => handleDialogNavigation("next")
                    : undefined
                }
                onPrevious={
                  child.id === activeChildId
                    ? () => handleDialogNavigation("previous")
                    : undefined
                }
                hasNext={
                  child.id === activeChildId
                    ? getDialogNavigationProps().hasNext
                    : false
                }
                hasPrevious={
                  child.id === activeChildId
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

StreetChildListings.displayName = "StreetChildListings";

export default StreetChildListings;
