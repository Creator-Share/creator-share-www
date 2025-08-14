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
import BeneficiaryActivity from "../SponsorshipActivity";
import BeneficiarySubscribeBox from "@/components/BeneficiarySubscribeBox";
import { toaster } from "@/components/ui/toaster";

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
  const [toastCount, setToastCount] = useState(0);
  const [lastToastTime, setLastToastTime] = useState(0);

  const getStatusText = (status: string) => {
    switch (status) {
      case "Budget Fulfilled":
        return "Sponsored";
      case "Partially Funded":
        return "Ongoing";
      case "New":
        return "Not funded";
      default:
        return "Not funded";
    }
  };

  const handleCopyLink = async () => {
    const now = Date.now();
    if (now - lastToastTime < 2000 || toastCount >= 3) {
      return;
    }

    try {
      const profileUrl = `${window.location.origin}/sponsorships/${beneficiary.username}`;

      await navigator.clipboard.writeText(profileUrl);

      setToastCount(prev => prev + 1);
      setLastToastTime(now);

      toaster.create({
        title: "Link Copied!",
        description: "Profile link has been copied to clipboard",
        duration: 3000,
      });
    } catch (err) {
      console.error('Failed to copy link:', err);
      const textArea = document.createElement('textarea');
      const profileUrl = `${window.location.origin}/sponsorships/${beneficiary.username}`;
      textArea.value = profileUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);

      setToastCount(prev => prev + 1);
      setLastToastTime(now);

      toaster.create({
        title: "Link Copied!",
        description: "Profile link has been copied to clipboard",
        duration: 3000,
      });
    }
  };

  const handleShareProfile = async () => {
    const profileUrl = `${window.location.origin}/sponsorships/${beneficiary.username}`;
    const shareText = `Check out ${beneficiary.name}'s profile on Creator Share. Help make a difference in their life!`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${beneficiary.name} - Creator Share`,
          text: shareText,
          url: profileUrl,
        });

        toaster.create({
          title: "Shared Successfully!",
          description: "Profile has been shared",
          duration: 3000,
        });
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Share failed:', error);
          toaster.create({
            title: "Share Failed",
            description: "Unable to share profile. Please try copying the link instead.",
            duration: 3000,
          });
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${shareText}\n\n${profileUrl}`);
        toaster.create({
          title: "Link Copied!",
          description: "Profile link and description copied to clipboard",
          duration: 3000,
        });
      } catch {
        const textArea = document.createElement('textarea');
        textArea.value = `${shareText}\n\n${profileUrl}`;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);

        toaster.create({
          title: "Link Copied!",
          description: "Profile link and description copied to clipboard",
          duration: 3000,
        });
      }
    }
  };

  useEffect(() => {
    if (!open) {
      setToastCount(0);
      setLastToastTime(0);
    }
  }, [open]);

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
      <DialogContent className="max-w-[400px] md:min-w-[1000px] md:max-w-[1000px] w-full relative rounded-2xl">
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
                className="rounded-t-[10px]"
                style={{ objectFit: "cover", objectPosition: "center 20%" }}
              />
              <Box className="text-center">
                <Text className="text-xl font-bold text-gray-800 mb-2">{beneficiary.name || "Full Name"}</Text>
                <Flex align="center" gap={2} mb={1} justify="center">
                  <FaCalendar className="text-[#0654C6]" />
                  <Text fontSize="md">
                    {beneficiary.birth_date ? new Date(beneficiary.birth_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "DOB"}
                  </Text>
                  <FaUser className="text-[#0654C6]" />
                  <Text fontSize="md">{beneficiary.gender || "Gender"}</Text>
                  <FaLocationDot className="text-[#0654C6]" />
                  <Text fontSize="md">{beneficiary.country || "Location"}</Text>
                </Flex>
              </Box>
              <Box className="mx-8">
                <Flex className="justify-center w-full">
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
                <Flex mt={4} className="justify-center w-full">
                  <Flex gap={4} className="w-full md:w-50%">
                    <Button
                      className="flex-1"
                      height="40px"
                      variant="outline"
                      _hover={{ bg: "black", color: "white" }}
                      onClick={handleCopyLink}
                      bg='#CDE1FE'
                    >
                      <FaLink style={{ marginRight: 6 }} />
                      Copy Link
                    </Button>
                    <Button
                      className="flex-1"
                      height="40px"
                      variant="outline"
                      _hover={{ bg: "black", color: "white" }}
                      onClick={handleShareProfile}
                      bg='#CDE1FE'
                    >
                      <FaShare style={{ marginRight: 6 }} />
                      Share Profile
                    </Button>
                  </Flex>
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
                <Box className="w-full bg-[#CDE1FE] h-2 rounded-full mb-3">
                  <Box
                    className="bg-[#0654C6] h-full rounded-full"
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
                <Box className="max-h-[240px] overflow-hidden overflow-y-scroll">
                  <Text fontSize="lg" fontWeight="bold" mb={2}>Child Bio</Text>
                  <Text color="gray.600" fontSize="sm">
                    {beneficiary.biography}
                  </Text>
                </Box>
              </Box>
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
                <BeneficiaryActivity beneficiaryId={beneficiary.id} username={beneficiary.username} />
              </Box>
              <Box className="my-3 md:my-0">
                <BeneficiarySubscribeBox beneficiary={beneficiary} />
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
