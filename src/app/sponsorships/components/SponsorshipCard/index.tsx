"use client";
import React, { useState, useEffect } from "react";
import { Box, Text, Flex, Badge } from "@chakra-ui/react";
import { FaCalendar } from "react-icons/fa";
import { FaLocationDot, FaPerson } from "react-icons/fa6";
import { calculateAge } from "@/utils/ageCalculator";
import { BeneficiaryCardProps } from "@/types/propTypes";
import Image from "next/image";
import { BeneficiaryMedia } from "@/types/admin.types";
import { centsToDollars } from "@/utils/currency";
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media";

const BeneficiaryCard: React.FC<BeneficiaryCardProps> = ({
  beneficiary,
  isSelected,
  id,
  onOpenDialog,
  beneficiaryType = "CHILD",
}) => {
  const [images, setImages] = useState<BeneficiaryMedia[]>([]);

  const placeholderImage =
    "https://media.istockphoto.com/id/1288129985/vector/missing-image-of-a-person-placeholder.jpg?s=612x612&w=0&k=20&c=9kE777krx5mrFHsxx02v60ideRWvIgI1RWzR1X4MG2Y=";

  useEffect(() => {
    const fetchImages = async () => {
      try {
        const response = await fetch(
          `/api/admin/beneficiaries/images/${beneficiary.id}`
        );
        if (response.ok) {
          const data = await response.json();
          setImages(
            data.sort(
              (a: BeneficiaryMedia, b: BeneficiaryMedia) =>
                a.order_index - b.order_index
            )
          );
        }
      } catch (error) {
        console.error("Error fetching images:", error);
      }
    };

    fetchImages();
  }, [beneficiary.id, beneficiaryType]);

  // Primary content
  const age = calculateAge(new Date(beneficiary.birth_date).toISOString());
  // onOpen handled by parent via prop

  return (
    <Box
      id={id}
      borderColor={isSelected ? "blue.500" : "gray.200"}
      borderWidth={isSelected ? "4px" : "1px"}
      className={`bg-white mb-6 rounded-[20px] shadow-md ${
        isSelected ? "highlight-child" : ""
      } hover:shadow-xl hover:shadow-black/20 hover:scale-105 transition-all duration-300`}
      suppressHydrationWarning={true}
      style={{ overflow: "hidden" }}
      maxW="sm"
      mx="auto"
      height="100%"
      display="flex"
      flexDirection="column"
      transform="translateZ(0)"
      cursor="pointer"
      transition="border-color 200ms ease, border-width 200ms ease, box-shadow 200ms ease, transform 200ms ease"
      _hover={{ borderColor: "#2B7FF9", borderWidth: "1px" }}
      onClick={() => onOpenDialog?.()}
    >
      {/* Card Header: Image with Target Badge */}
      <Box position="relative" flexShrink={0}>
        <Image
          src={images.length > 0 ? (images[0].id ? generatePublicUrl(images[0] as unknown as MediaRow) : images[0].image_url) : placeholderImage}
          alt={beneficiary.name?.split(" ")[0] ?? ""}
          width={500}
          height={500}
          style={{ objectFit: "cover", objectPosition: "center 20%" }}
          className="w-full h-64 rounded-t-[20px]"
        />
        <Box position="absolute" top="0" right="0" zIndex={10}>
          <Badge
            bg="#CDE1FE"
            color="#011532"
            borderRadius="0"
            borderTopRightRadius="20px"
            borderBottomLeftRadius="20px"
            className="p-[10px] text-sm font-medium"
          >
            Goal{" "}
            <span className="text-xl font-semibold">
              ${centsToDollars(beneficiary.budget_goal)}
            </span>
          </Badge>
        </Box>
      </Box>

      {/* Card Content */}
      <Box
        p={6}
        flex="1"
        display="flex"
        flexDirection="column"
        className="items-center text-center justify-center"
      >
        {/* Full Name Heading */}
        <Text fontSize="xl" fontWeight="bold" mb={3} className="text-gray-800">
          {beneficiary.name?.split(" ")[0] || "Name"}
        </Text>

        {/* Information Row */}
        <Flex gap={4} mb={4} flexWrap="wrap" className="text-[#666666]">
          <Flex align="center" gap={1}>
            <FaCalendar />
            <Text fontSize="sm">{age ? `${age} years` : "DOB"}</Text>
          </Flex>
          <Flex align="center" gap={1}>
            <FaPerson />
            <Text fontSize="sm">{beneficiary.gender || "Gender"}</Text>
          </Flex>
          <Flex align="center" gap={1}>
            <FaLocationDot />
            <Text fontSize="sm">{beneficiary.country || "Location"}</Text>
          </Flex>
        </Flex>

        {/* Info Section */}
        <Box mb={4} flex="1">
          {" "}
          {/* Add flex="1" to take available space */}
          <Text
            fontSize="sm"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
              lineHeight: "1.4",
              color: "#666666",
            }}
          >
            {beneficiary?.biography}
          </Text>
        </Box>
      </Box>
      {/* Card click will be handled by parent via onOpenDialog prop. */}
    </Box>
  );
};

export default BeneficiaryCard;
