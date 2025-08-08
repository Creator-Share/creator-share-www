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
import { Beneficiaries } from "@/types/index";
import { fetchActivitiesByBeneficiaryId, fetchSponsorshipDetailsByBeneficiaryId } from "@/actions";
import SponsorshipDetails from "../SponsorshipDetails";
import BeneficiarySubscribeBox from "@/components/BeneficiarySubscribeBox";

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
        <DialogHeader className="flex justify-between items-center p-6 pb-2">
          <Text className="text-2xl font-bold text-gray-800">Child Details</Text>
          <DialogCloseTrigger>
            <Box className="text-lg font-semibold cursor-pointer border-2 border-[#000000] rounded-full px-2">×</Box>
          </DialogCloseTrigger>
        </DialogHeader>
        <DialogBody className="p-0">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-60 z-50 rounded-2xl">
              <Spinner size="xl" color="#1C3C8C" />
            </div>
          )}
          <Box
            className="px-8 md:grid md:grid-cols-2 md:gap-4"
          >
            <Box className="h-[523px] border border-[#0654C6] rounded-[10px] flex flex-col text-center gap-[11px] relative">
              {/* Status Overlay */}
              <Box className="absolute top-2 right-2 z-10 bg-[#CDE1FE] text-[#0654C6] rounded-[10px] p-[10px] flex items-center gap-2">
                <FaCircleInfo />
                <Text className="text-xs font-medium">
                  {getStatusText(beneficiary.status)}
                </Text>
              </Box>

              <Image
                src={beneficiary.image_url || "/placeholder-child.jpg"}
                alt={beneficiary.name || "Child"}
                width={500}
                height={293}
                className="rounded-t-[10px] object-cover"
              />
              <Box className="text-center">
                <Text className="text-xl font-bold text-gray-800 mb-2">{beneficiary.name || "Full Name"}</Text>
                <Flex align="center" gap={2} mb={1} justify="center">
                  <FaCalendar className="text-[#CC9200]" />
                  <Text fontSize="md">
                    {beneficiary.birth_date ? new Date(beneficiary.birth_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "DOB"}
                  </Text>
                  <FaUser className="text-[#CC9200]" />
                  <Text fontSize="md">{beneficiary.gender || "Gender"}</Text>
                  <FaLocationDot className="text-[#CC9200]" />
                  <Text fontSize="md">{beneficiary.country || "Location"}</Text>
                </Flex>
              </Box>
              <Box className="mx-8">
                <Flex className="justify-center w-full md:justify-start">
                  <Button
                    className="w-full md:w-50%"
                    bg="#0654C6"
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
                  <Button className="border border-[#000000] p-4" height="40px" variant="outline" _hover={{ bg: "black", color: "white" }} size="sm">
                    <FaLink style={{ marginRight: 6 }} />
                    Copy Link
                  </Button>
                  <Button className="border border-[#000000] p-4" variant="outline" size="sm" height="40px" _hover={{ bg: "black", color: "white" }}>
                    <FaShare style={{ marginRight: 6 }} />
                    Share Profile
                  </Button>
                </Flex>
              </Box>
            </Box>
            <Box my={4}
              borderRadius="xl"
              className="h-[523px]">
              {/* Sponsorship Target */}
              <Box mb={2}>
                <Box className="flex justify-between">
                  <Text className="text-sm text-[#52667A] font-normal" mb={2}>Sponsorship Target</Text>
                  <Text className="text-sm font-normal" mb={2}>
                    {beneficiary.budget_goal > 0
                      ? Math.round((beneficiary.budget_raised / beneficiary.budget_goal) * 100)
                      : 0}%
                  </Text>
                </Box>
                <Box className="w-full bg-[#FED9CD] h-2 rounded-full mb-3">
                  <Box
                    className="bg-[#C63306] h-full rounded-full"
                    style={{
                      width: `${beneficiary.budget_goal > 0
                        ? Math.min((beneficiary.budget_raised / beneficiary.budget_goal) * 100, 100)
                        : 0}%`
                    }}
                  />
                </Box>
              </Box>
              <Box
                bg="#CDE1FE"
                p={4}
                borderRadius="xl"
              >
                <Box className="h-[120px] overflow-hidden overflow-y-scroll">
                  <Text fontSize="lg" fontWeight="bold" mb={2}>Child Bio</Text>
                  <Text color="gray.600" fontSize="sm">
                    {beneficiary.biography}
                  </Text>
                </Box>
                <Box className="h-[120px] mt-2">
                  <Text fontSize="lg" fontWeight="bold" mb={2}>Medical History</Text>
                  <Text color="gray.600" fontSize="sm">
                    ullamcorper Donec orci tincidunt sollicitudin. vitae elit nibh tempor laoreet nec quam vitae sapien tincidunt placerat Nunc eget lobortis, lacus, quis leo. ex
                  </Text>
                </Box>
              </Box>
              {/* Video Placeholder */}
              <Box
                bg="white"
                borderRadius="xl"
                mt={4}
                className="flex justify-center items-center min-h-[160px]"
              >
                {beneficiary.video_url && beneficiary.video_url.trim() !== "" ? (
                  <video className="rounded-xl max-h-40 w-full" src={beneficiary.video_url} controls />
                ) : (
                  <Text className="text-center text-gray-500">No Media Available</Text>
                )}
              </Box>
            </Box>
          </Box>
          <Box mb={4}>
            <Box className="px-8 md:grid md:grid-cols-2 md:items-stretch gap-4">
              <Box className="">
                <SponsorshipDetails beneficiaryId={beneficiary.id} hideStatus hideAmount />
              </Box>
              <Box className="my-3 md:my-0">
                <BeneficiarySubscribeBox beneficiary={beneficiary} />
              </Box>
            </Box>
            <Box className="px-8 md:grid md:grid-cols-2 gap-4 md:px-8">
              <Flex className="justify-center w-full md:justify-start">
                <Button
                  className="w-full md:w-50%"
                  bg="#0654C6"
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
                <Button className="border border-[#000000] p-4" height="40px" variant="outline" size="sm" _hover={{ bg: "black", color: "white" }}>
                  <FaLink style={{ marginRight: 6 }} />
                  Copy Link
                </Button>
                <Button className="border border-[#000000] p-4" variant="outline" size="sm" height="40px" _hover={{ bg: "black", color: "white" }}>
                  <FaShare style={{ marginRight: 6 }} />
                  Share Profile
                </Button>
              </Flex>
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
