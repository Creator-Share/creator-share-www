import React, { useEffect, useState } from "react";
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogCloseTrigger,
} from "@/components/ui/dialog";
import { Box, Text, Image, Spinner, Button } from "@chakra-ui/react";
import SponsorshipDetails from "../SponsorshipDetails";
import SponsorDialog from "../SponsorDialog";
import BeneficiaryActivity from "../SponsorshipActivity";
import { FaCalendar, FaPerson } from "react-icons/fa6";
import { FaLocationDot } from "react-icons/fa6";
import { calculateAge } from "@/utils/ageCalculator";
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
        return (
          <Box className="flex flex-col items-center">
            <Image src="/fulfilled.png" alt="Fulfilled" width={73} height={84} className="mb-2" />
            <Text className="text-[#03150E] font-bold text-center">Sponsored</Text>
          </Box>
        );
      case "Partially Funded":
        return (
          <Box className="flex flex-col items-center">
            <Image src="/pending.png" alt="Pending" width={73} height={84} className="mb-2" />
            <Text className="text-[#767070] text-center">On Going</Text>
          </Box>
        );
      case "New":
        return <Text className="text-[#767070] text-center">Sponsor</Text>;
      default:
        return <Text className="text-[#767070] text-center">Nothing to show</Text>;
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
      <DialogContent className="bg-[#F5F5F5] rounded-2xl max-w-[700px] w-full relative">
        <DialogHeader className="absolute right-4 top-4">
          <DialogCloseTrigger />
        </DialogHeader>
        <DialogBody className="p-8">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-60 z-50 rounded-2xl">
              <Spinner size="xl" color="#1C3C8C" />
            </div>
          )}
          <Box>
            <Box className="flex gap-6 md:flex-row flex-col">
              <div className="flex flex-1 items-center bg-white rounded-xl p-6 shadow-sm">
                <Image
                  src={beneficiary.image_url || "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y="}
                  alt={beneficiary.name}
                  className="object-cover rounded-full"
                  width={115}
                  height={115}
                />
                <div className="ml-6">
                  <div className="text-2xl font-bold text-[#03150E] mb-1">{beneficiary.name}</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[#767070] text-base md:items-center md:flex-row flex-col items-start">
                    <div className="flex items-center gap-1 md:flex-row flex-col">
                      <div className="flex flex-row gap-1">
                        <FaCalendar className="mt-1"/>
                        <span>
                          {beneficiary.birth_date
                            ? new Date(beneficiary.birth_date).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
                            : "N/A"}
                        </span>
                      </div>
                      <span className="ml-2 text-xs text-[#767070]">
                        {beneficiary.birth_date ? `${calculateAge(beneficiary.birth_date)} yrs old` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <FaPerson />
                      <span>{beneficiary.gender}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <FaLocationDot />
                      <span>{beneficiary.country}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-center justify-center bg-white rounded-xl p-6 min-w-[200px] shadow-sm">
                {getStatusText(beneficiary.status)}
              </div>
            </Box>
            <Box className="my-4 flex gap-3 md:flex-row flex-col">
              <Button
                className="bg-white text-[#1C3C8C] hover:text-white hover:bg-[#1C3C8C] px-8 py-3 rounded-lg font-medium"
                onClick={() => window.location.assign(`/sponsorships/${beneficiary.username}`)}
              >
                See Full Profile
              </Button>
              <Button
                className="bg-[#1C3C8C] text-white hover:bg-[#15307A] px-8 py-3 rounded-lg font-medium"
                onClick={() => setSponsorDialogOpen(true)}
              >
                Sponsor {beneficiary.name}
              </Button>
              <SponsorDialog
                people={beneficiary}
                isOpen={sponsorDialogOpen}
                onOpenChange={setSponsorDialogOpen}
                trigger={<div style={{ display: "none" }} />}
              />
            </Box>

            <Box mb={8}>
              <SponsorshipDetails beneficiaryId={beneficiary.id} />
            </Box>
            <Box mb={8}>
              <Text fontSize="lg" fontWeight="semibold" mb={4}>
                Quick Updates
              </Text>
              <BeneficiaryActivity beneficiaryId={beneficiary.id} username={beneficiary.username} />
            </Box>
          </Box>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  );
};

export default BeneficiaryActivityModal;
