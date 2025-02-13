"use client"
import React, { useState } from "react";
import { Box, Text, Image, Flex, Input, InputAddon, Progress, HStack } from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogHeader,
  DialogRoot,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  SelectRoot,
  SelectTrigger,
  SelectValueText,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { centsToDollars } from "@/utils/currency";
import { toaster } from "@/components/ui/toaster";
import { paymentOptionsCollection } from "../ChildCard/config";
import { SponsorPeople } from "@/types";
import { useAuthStore } from "@/store/authStore";

interface SponsorDialogProps {
  people: SponsorPeople;
  trigger: React.ReactNode;
}

const SponsorDialog: React.FC<SponsorDialogProps> = ({ people, trigger }) => {
  const remainingAmount = (people.budget_goal - people.budget_raised) / 100;
  const [amount, setAmount] = useState<number>(0);
  const [selectedOption, setSelectedOption] = useState<string>(paymentOptionsCollection.items[0].value);
  const [value, setValue] = useState<number[]>([0]);
  const [loading, setLoading] = useState<boolean>(false);
  const user = useAuthStore((state) => state.user);
  console.log(user?.id);

  const handleSliderChange = (e: { value: number[] }) => {
    const newValue = Math.min(e.value[0], remainingAmount);
    setValue([newValue]);
    setAmount(newValue);
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let newValue = parseInt(e.target.value) || 0;
    newValue = Math.min(newValue, remainingAmount);
    setAmount(newValue);
    setValue([newValue]);
  };

  const handleSponsor = async () => {
    if (amount <= 0) {
      toaster.create({
        title: "Invalid Amount",
        description: "Please enter a valid amount.",
      });
      return;
    }

    if (amount > remainingAmount) {
      toaster.create({
        title: "Invalid Amount",
        description: "Amount exceeds the remaining budget needed.",
      });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/stripe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          childId: people.id,
          childName: people.name,
          childImage: people.image_url,
          amount: amount * 100,
          paymentType: selectedOption,
          location: people.country,
          userId: user?.id,
        }),
      });

      const { url } = await res.json();
      if (url) {
        document.getElementById('closeDialog')?.click();
        
        if (window.self !== window.top) {
          window.open(url, '_blank');
        } else {
          window.location.href = url;
        }
      }
    } catch (err) {
      toaster.create({
        title: "Payment Error",
        description: "Something went wrong. Please try again.",
      });
      console.error("Payment Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectChange = (value: string) => {
    setSelectedOption(value);
  };

  const renderDisclaimer = () => {
    if ((people.budget_goal - people.budget_raised - amount * 100) > 0) {
      return (
        <>
          This child has a monthly budget goal that must be met for enrollment in school.
          <br />
          Additional sponsors are required to meet this goal.
        </>
      );
    } else if (people.budget_raised > 0) {
      return "This child is partially sponsored. Your contribution will help reach their monthly budget goal!";
    }
    return "Your sponsorship will be applied towards the child's monthly budget goals.";
  };

  return (
    <DialogRoot size="cover" placement="center" motionPreset="slide-in-bottom" role="alertdialog">
      <DialogTrigger asChild>
        {trigger}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto mx-auto my-4">
        <DialogHeader>
          <DialogCloseTrigger id="closeDialog" />
        </DialogHeader>
        <DialogBody>
          <Box className="flex flex-col md:grid md:grid-cols-2 gap-6">
            <Image
              src={people.image_url}
              alt={people.name}
              width={{ base: 300, md: 500 }}
              height={{ base: 300, md: 500 }}
              className="rounded-lg w-full h-auto object-cover"
            />
            <Box className="md:mr-14 flex flex-col">
              <Text className="text-2xl text-center font-bold mt-4 md:mt-0 md:text-start">
                {people.name}
              </Text>
              <Progress.Root
                defaultValue={Math.min((people.budget_raised / people.budget_goal) * 100, 100)}
                my={8}
              >
                <Text className="text-end text-base text-[#959090] font-normal">
                  Goal: {`$${centsToDollars(people.budget_goal)}`}
                </Text>
                <Tooltip
                  content={`$${centsToDollars(people.budget_raised)} raised`}
                  showArrow
                  positioning={{ placement: "right-end" }}
                >
                  <HStack gap="5">
                    <Progress.Track className="rounded-lg h-3" flex="1">
                      <Progress.Range className="bg-[#1C3C8C]" />
                    </Progress.Track>
                  </HStack>
                </Tooltip>
              </Progress.Root>
              <Box>
                <Text mt={1} className="font-semibold text-base mb-[10px]">
                  Amount
                </Text>
                <Flex
                  className="border rounded-lg"
                  mb={4}
                  align="center"
                  justify="center"
                  gap={2}
                >
                  <InputAddon className="bg-[#D6D6D6] px-[15px] py-[5px] m-1 text-[#959090] text-base font-medium">
                    $
                  </InputAddon>
                  <Input
                    type="number"
                    min="1"
                    max={remainingAmount}
                    value={amount}
                    onChange={handleAmountChange}
                    className="px-4 h-[50px]"
                    placeholder="Enter Amount"
                  />
                </Flex>
                <Box my={4}>
                  <Slider
                    value={value}
                    min={0}
                    max={remainingAmount}
                    step={5}
                    variant="solid"
                    onValueChange={handleSliderChange}
                  />
                  <Text textAlign="center" mt={2}>Selected Amount: ${value[0]}</Text>
                </Box>
                <Box gap={8}>
                  <Text mb={2} className="font-semibold text-base">Frequency</Text>
                  <SelectRoot
                    collection={paymentOptionsCollection}
                    className="border rounded-lg"
                    my={8}
                    px={4}
                    py={2}
                    defaultValue={[paymentOptionsCollection.items[0].value]}
                    onValueChange={(details) => handleSelectChange(details.value[0])}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValueText />
                    </SelectTrigger>
                    <SelectContent className="z-[9999]">
                      {paymentOptionsCollection.items.map((option) => (
                        <SelectItem key={option.value} item={option}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </SelectRoot>
                </Box>
              </Box>
              <Button
                bg="#1C3C8C"
                color="white"
                mt={4}
                loading={loading}
                loadingText="Processing..."
                onClick={handleSponsor}
                disabled={loading}
                className="w-full"
              >
                Sponsor {people.name}
              </Button>
              <Text color="gray.500" textAlign="center" p={1}>
                {renderDisclaimer()}
              </Text>
            </Box>
          </Box>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  );
};

export default SponsorDialog; 