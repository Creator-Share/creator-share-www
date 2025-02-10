"use client";
import { useState } from "react";
import { Box, Flex, Text, Image, Button, Input, InputAddon } from "@chakra-ui/react";
import { FaCalendar } from "react-icons/fa";
import { FaLocationDot } from "react-icons/fa6";
import { People } from "@/types";
import { useRouter } from "next/navigation";
import { calculateAge } from "@/utils/ageCalculator";
import { formatDate } from "@/utils/dateFormatter";
import { loadStripe } from "@stripe/stripe-js";
import { Checkbox } from "@/components/ui/checkbox";
import { ChildCardProps } from "@/types/propTypes";
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string);

const ChildDetailsCard: React.FC<ChildCardProps> = ({ people, isSelected }) => {
    const router = useRouter();
    const [amount, setAmount] = useState<string>("");
    const [selectedOption, setSelectedOption] = useState<string | null>(null);

    const handleNavigateChild = () => {
        router.push(`/sponsor-a-child/${people.id}`);
    };

    const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        if (/^\d*\.?\d*$/.test(value)) {
            setAmount(value);
        }
    };

    const handleSponsor = async () => {
        if (!people || !amount || parseFloat(amount) <= 0) {
            alert("Please enter a valid amount.");
            return;
        }

        try {
            const stripe = await stripePromise;
            const res = await fetch("/api/stripe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    childId: people.id,
                    childName: people.name,
                    amount: parseFloat(amount) * 100,
                    paymentType: selectedOption,
                }),
            });

            const { url } = await res.json();
            if (url) {
                window.location.href = url;
            }
            console.log(stripe)
        } catch (err) {
            console.error("Payment Error:", err);
        }
    };

    const handleCheckboxChange = (option: string) => {
        setSelectedOption((prev) => (prev === option ? null : option));
    };

    const age = calculateAge(new Date(people.birth_date).toISOString());
    const formattedBirthDate = formatDate(new Date(people.birth_date).toISOString());

    return (
        <Flex
            direction={{ base: "column", md: "row" }}
            align={{ base: "center", md: "flex-start" }}
            textAlign={{ base: "center", md: "left" }}
            borderWidth="1px"
            borderColor={isSelected ? "blue.500" : "gray.200"}
            borderRadius={{ base: 'lg', md: 'md' }}
            boxShadow="sm"
            className="bg-white shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer p-6 mb-6 md:p-0 md:mb-0 "
            onClick={handleNavigateChild}
        >
            <Box>
                <Image
                    src={people.image_url}
                    alt={people.name}
                    boxSize={{ base: "150px", md: "273px" }}
                    objectFit="cover"
                    borderRadius={{ base: "full", md: "md" }}
                    className="mb-4 md:mb-0"
                />
            </Box>
            <Box className="md:grid md:grid-cols-2 pt-[20px]">
                <Box ml={{ md: 6 }} w="full">
                    <Text fontSize="4xl" fontWeight="bold" mb={2} className="text-[#03150E]">
                        {people.name}
                    </Text>
                    <Box fontSize="base" className="text-[#767070]">
                        <Flex justify={{ base: "center", md: "flex-start" }} align="center" gap={2} mb={4}>
                            <FaCalendar />
                            <Text fontSize="sm" className="text-gray-500">
                                {formattedBirthDate} | {age} years old
                            </Text>
                        </Flex>
                        <Flex justify={{ base: "center", md: "flex-start" }} align="center" gap={2}>
                            <FaLocationDot />
                            <Text fontSize="sm" className="text-gray-500">
                                {people.country}
                            </Text>
                        </Flex>
                    </Box>

                    <Box className="mt-8 w-full" mb={4}>
                        <Flex
                            className="border rounded-lg"
                            mb={4}
                            align="center"
                            justify="center"
                            gap={2}
                        >
                            <InputAddon>
                                $
                            </InputAddon>
                            <Input
                                type="number"
                                min="1"
                                value={amount}
                                onChange={handleAmountChange}
                                className="px-4"
                                placeholder="Enter Amount"
                            />
                        </Flex>
                        <Flex justify="center" align="center" gap={8}>
                            <Flex align="center" gap={2}>
                                <Checkbox
                                    className="border rounded-md border-[#8D9692]"
                                    checked={selectedOption === "subscription"}
                                    onChange={() => handleCheckboxChange("subscription")}
                                />
                                <Text>Monthly</Text>
                            </Flex>
                            <Flex align="center" gap={2}>
                                <Checkbox
                                    className="border rounded-md border-[#8D9692]"
                                    checked={selectedOption === "payment"}
                                    onChange={() => handleCheckboxChange("payment")}
                                />
                                <Text>One-time</Text>
                            </Flex>
                        </Flex>
                    </Box>
                </Box>
                <Box className="md:ml-14">
                    <Text fontSize="4xl" fontWeight="bold" className="text-[#03150E] mb-1">
                        Bio
                    </Text>
                    <Box fontSize="base" mb={3}>
                        <Text className="text-[#767070] mb-4">
                            {people.biography}
                        </Text>
                        <Text fontWeight="md" className="text-[#1C3C8C] cursor-pointer hover:underline">
                            Learn more about {people.name}
                        </Text>
                    </Box>
                    <Button
                        mt={4}
                        onClick={handleSponsor}
                        className="bg-[#1C3C8C] hover:bg-blue-800 text-white font-semibold text-base rounded-[4px] px-[18px] w-2/3 py-3 md:ml-6"
                    >
                        Sponsor
                    </Button>
                </Box>
            </Box>
        </Flex>
    );
};

export default ChildDetailsCard;
