import React, { useEffect, useState } from "react";
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogCloseTrigger,
} from "@/components/ui/dialog";
import { Box, Text, Image, Spinner, Button, Flex } from "@chakra-ui/react";
import SponsorDialog from "../SponsorDialog";
import { FaCalendar, FaUser, FaLocationDot, FaCircleInfo, FaLink, FaShare } from "react-icons/fa6";
import { centsToDollars } from "@/utils/currency";
import { Beneficiaries } from "@/types/index";
import { fetchActivitiesByBeneficiaryId, fetchSponsorshipDetailsByBeneficiaryId } from "@/actions";

interface BeneficiaryActivityModalProps {
  open: boolean;
  onClose: () => void;
  beneficiary: Beneficiaries;
}

const BeneficiaryActivityModal: React.FC<BeneficiaryActivityModalProps> = ({
  open,
  onClose,
  beneficiary,
}) => {
  const [loading, setLoading] = useState(true);
  const [sponsorDialogOpen, setSponsorDialogOpen] = useState(false);

  const getStatusText = (status: string) => {
    switch (status) {
      case "Budget Fulfilled":
        return "Sponsored";
      case "Partially Funded":
        return "On Going";
      case "New":
        return "Not funded";
      default:
        return "Not funded";
    }
  };

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const fetchData = async () => {
      try {
        await fetchSponsorshipDetailsByBeneficiaryId(beneficiary.id);
        await fetchActivitiesByBeneficiaryId(beneficiary.id);
      } catch {
      }
      setLoading(false);
    };
    fetchData();
  }, [open, beneficiary.id]);

  return (
    <DialogRoot open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-[800px] w-full relative rounded-2xl">
        <DialogHeader className="bg-[#D9D9D9] flex justify-between items-center p-6 pb-2">
          <Text className="text-2xl font-bold text-gray-800">Child Details</Text>
          <DialogCloseTrigger>
            <Box className="text-2xl cursor-pointer">×</Box>
          </DialogCloseTrigger>
        </DialogHeader>
        <DialogBody className="p-0">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-60 z-50 rounded-2xl">
              <Spinner size="xl" color="#1C3C8C" />
            </div>
          )}
          <Box
            className="md:grid md:grid-cols-2 px-8"
            style={{
              background: 'linear-gradient(to bottom, #D9D9D9 0%, #D9D9D9 50%, transparent 50%, transparent 100%)'
            }}
          >
            <Image
              src={beneficiary.image_url || "/placeholder-child.jpg"}
              alt={beneficiary.name}
              width={179.34}
              height={179.34}
              className="rounded-full object-cover border-4 border-white bg-gray-200"
            />
            <Flex flex="1" minW="0" direction="column" align="flex-end" justify="flex-end" gap={2}>
              <Flex align="center" gap={2} mb={2}>
                <Text fontSize="lg">Sponsorship status</Text>
                <FaCircleInfo />
              </Flex>
              <Box className="px-3 py-1 bg-gray-200 rounded text-gray-700 font-semibold text-sm">
                {getStatusText(beneficiary.status)}
              </Box>
            </Flex>
          </Box>
          <Box py={4}>
            <Box className="grid grid-cols-2" gap={6} mb={6} px={8}>
              {/* Profile Info */}
              <Box className="col-span-2" gap={6}>
                <Box>
                  <Text className="text-xl font-bold text-gray-800 mb-2">{beneficiary.name || "Full Name"}</Text>
                  <Flex align="center" gap={2} mb={1}>
                    <FaCalendar />
                    <Text fontSize="md">
                      {beneficiary.birth_date ? new Date(beneficiary.birth_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "DOB"}
                    </Text>
                    <FaUser className="ml-4" />
                    <Text fontSize="md">{beneficiary.gender || "Gender"}</Text>
                  </Flex>
                  <Flex align="center" gap={2}>
                    <FaLocationDot />
                    <Text fontSize="md">{beneficiary.country || "Location"}</Text>
                  </Flex>
                  <Box className="md:grid md:grid-cols-2 gap-4">
                    <Flex className="justify-center w-full md:justify-start">
                      <Button
                        className="w-full md:w-50%"
                        bg="black"
                        color="white"
                        onClick={() => setSponsorDialogOpen(true)}
                        height="40px"
                        _hover={{ bg: "black" }}
                        mt={4}
                      >
                        Sponsor Child
                      </Button>
                    </Flex>
                    <Flex mt={4} gap={4} className="justify-center md:justify-end md:tems-end">
                      <Button className="border border-[#000000] p-4" height="40px" variant="outline" size="sm">
                        <FaLink style={{ marginRight: 6 }} />
                        Copy Link
                      </Button>
                      <Button className="border border-[#000000] p-4" variant="outline" size="sm" height="40px">
                        <FaShare style={{ marginRight: 6 }} />
                        Share Profile
                      </Button>
                    </Flex>
                  </Box>

                </Box>
              </Box>
            </Box>
            <Box className="flex flex-col gap-4 md:grid md:grid-cols-3 md:gap-4" px={8}>
              {/* Medical History */}
              <Box
                bg="#E0E0E0"
                p={4}
                borderRadius="xl"
                className="col-span-2"
              >
                <Text fontSize="lg" fontWeight="bold" mb={2}>Medical History</Text>
                <Text color="gray.600" fontSize="sm">
                  ullamcorper Donec orci tincidunt sollicitudin. vitae elit nibh tempor laoreet nec quam vitae sapien tincidunt placerat Nunc eget lobortis, lacus, quis leo. ex
                </Text>
              </Box>
              {/* Sponsorship Target */}
              <Box
                bg="#E0E0E0"
                p={4}
                borderRadius="xl"
              >
                <Text fontSize="lg" fontWeight="bold" mb={2}>Sponsorship Target</Text>
                <Text fontSize="2xl" fontWeight="bold" mb={2}>
                  {beneficiary.budget_goal > 0
                    ? Math.round((beneficiary.budget_raised / beneficiary.budget_goal) * 100)
                    : 0}%
                </Text>
                <Box className="w-full bg-gray-100 h-2 rounded-full mb-3">
                  <Box
                    className="bg-gray-500 h-full rounded-full"
                    style={{
                      width: `${beneficiary.budget_goal > 0
                        ? Math.min((beneficiary.budget_raised / beneficiary.budget_goal) * 100, 100)
                        : 0}%`
                    }}
                  />
                </Box>
                <Text color="gray.600" fontSize="sm">${centsToDollars(beneficiary.budget_raised)}  of ${centsToDollars(beneficiary.budget_goal)} funded</Text>
              </Box>
            </Box>
            <Box className="flex flex-col gap-4 md:grid md:grid-cols-2 md:gap-4 mt-4" px={8}>
              {/* Child Bio */}
              <Box
                bg="white"
                p={4}
                borderRadius="xl"
              >
                <Text fontSize="lg" fontWeight="bold" mb={2}>Child Bio</Text>
                <Text color="gray.600" fontSize="sm">
                  {beneficiary.biography}
                </Text>
              </Box>
              {/* Video Placeholder */}
              <Box
                bg="white"
                p={4}
                borderRadius="xl"
              >
                <svg width="64" height="64" fill="none" viewBox="0 0 64 64">
                  <rect width="64" height="64" rx="16" fill="#F3F4F6" />
                  <path d="M24 20V44L44 32L24 20Z" fill="#D1D5DB" />
                </svg>
              </Box>
            </Box>
          </Box>

          <SponsorDialog
            people={beneficiary}
            isOpen={sponsorDialogOpen}
            onOpenChange={setSponsorDialogOpen}
            trigger={<div style={{ display: "none" }} />}
          />
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  );
};

export default BeneficiaryActivityModal;
