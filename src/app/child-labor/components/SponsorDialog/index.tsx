"use client";
import React from "react";
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogCloseTrigger,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Box, Text, VStack, HStack } from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
import { SponsorPeople } from "@/types";
import { centsToDollars } from "@/utils/currency";

interface SponsorDialogProps {
  people: SponsorPeople;
  isOpen: boolean;
  onOpenChange: (details: { open: boolean }) => void;
  onNext?: () => void;
  onPrevious?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
  trigger: React.ReactNode;
}

const SponsorDialog: React.FC<SponsorDialogProps> = ({
  people,
  isOpen,
  onOpenChange,
  onNext,
  onPrevious,
  hasNext,
  hasPrevious,
  trigger,
}) => {
  const handleSponsor = () => {
    window.location.href = `/child-labor/checkout?id=${people.id}`;
  };

  return (
    <DialogRoot open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogCloseTrigger />
        </DialogHeader>
        <DialogBody>
          <VStack gap={6} align="stretch">
            <Text fontSize="2xl" fontWeight="bold" color="#1C3C8C">
              Sponsor {people.name}
            </Text>
            <Text>
              Your monthly sponsorship of ${centsToDollars(people.budget_goal)} will help provide:
            </Text>
            <Box className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Box className="bg-gray-50 p-4 rounded-lg">
                <Text fontWeight="semibold" mb={2}>
                  Essential Support
                </Text>
                <Text>
                  • Education access
                  <br />
                  • Safe shelter
                  <br />
                  • Nutritious meals
                  <br />
                  • Healthcare services
                </Text>
              </Box>
              <Box className="bg-gray-50 p-4 rounded-lg">
                <Text fontWeight="semibold" mb={2}>
                  Additional Support
                </Text>
                <Text>
                  • Counseling services
                  <br />
                  • Life skills training
                  <br />
                  • Legal assistance
                  <br />
                  • Family support
                </Text>
              </Box>
            </Box>
            <Box className="bg-gray-50 p-4 rounded-lg">
              <Text fontWeight="semibold" mb={2}>
                Your Impact
              </Text>
              <Text>
                By sponsoring {people.name}, you're helping rescue a child from exploitative labor.
                Your support provides education, protection, and opportunities for a better future,
                breaking the cycle of child labor and poverty.
              </Text>
            </Box>
            <HStack justify="space-between" pt={4}>
              <HStack gap={2}>
                <Button
                  onClick={onPrevious}
                  disabled={!hasPrevious}
                  variant="outline"
                >
                  Previous
                </Button>
                <Button onClick={onNext} disabled={!hasNext} variant="outline">
                  Next
                </Button>
              </HStack>
              <Button
                onClick={handleSponsor}
                className="bg-[#1C3C8C] text-white hover:bg-[#152a63]"
              >
                Sponsor Now
              </Button>
            </HStack>
          </VStack>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  );
};

export default SponsorDialog;
