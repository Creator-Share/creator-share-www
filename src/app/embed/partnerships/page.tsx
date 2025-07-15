"use client";

import React, { useState } from "react";
import { Box, Flex, Input, InputAddon, Text } from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
import { NativeSelectRoot, NativeSelectField } from "@/components/ui/native-select";
import { Slider } from "@/components/ui/slider";
import { toaster } from "@/components/ui/toaster";

const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

export default function PartnershipsPage() {
  const [amount, setAmount] = useState<number>(0);
  const [inputValue, setInputValue] = useState<string>("");
  const [selectedOption, setSelectedOption] = useState<string>("subscription");
  const [value, setValue] = useState<number[]>([0]);
  const [project, setProject] = useState<string>("general");
  const [loading, setLoading] = useState<boolean>(false);
  const [email, setEmail] = useState<string>("");

  const minimumAmount = 10;
  const maximumAmount = 1000;

  const handleSliderChange = (e: { value: number[] }) => {
    const newValue = Math.min(e.value[0], maximumAmount);
    setValue([newValue]);
    setAmount(newValue);
    setInputValue(newValue.toString());
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d+$/.test(value)) {
      if (value !== '') {
        const numericValue = parseInt(value);
        if (!isNaN(numericValue)) {
          if (numericValue > maximumAmount) {
            setInputValue(maximumAmount.toString());
            setAmount(maximumAmount);
            setValue([maximumAmount]);
            return;
          }
        }
      }

      setInputValue(value);

      if (value === '') {
        setAmount(0);
        setValue([0]);
      } else {
        const numericValue = parseInt(value);
        if (!isNaN(numericValue)) {
          setAmount(numericValue);
          setValue([numericValue]);
        }
      }
    }
  };

  const projectOptions = [
    { value: 'emergency', label: 'Emergency Medical Care' },
    { value: 'education', label: 'Education Support' },
    { value: 'shelter', label: 'Safe Shelter' },
    { value: 'nutrition', label: 'Nutrition Program' },
    { value: 'general', label: 'Area of Greatest Need' }
  ];

  const frequencyOptions = [
    { value: 'monthly', label: 'Monthly' },
    { value: 'annually', label: 'Yearly' }
  ];

  const handleSubmit = async () => {
    if (amount < minimumAmount) {
      toaster.create({
        title: "Invalid Amount",
        description: `Minimum partnership amount is $${minimumAmount}.`,
      });
      return;
    }

    if (!email || !/^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/.test(email)) {
      toaster.create({
        title: "Invalid Email",
        description: "Please enter a valid email address.",
      });
      return;
    }

    setLoading(true);
    try {
      const payload = {
        amount: amount * 100,
        paymentType: selectedOption,
        project,
        type: 'partnership',
        isEmbedded: true,
        email
      };

      const res = await fetch("/api/stripe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error('Payment API Error:', data);
        toaster.create({
          title: "Payment Error",
          description: data?.error || "Something went wrong. Please try again.",
        });
        return;
      }

      const { clientSecret, url } = data;
      if (!clientSecret && !url) {
        console.error('Missing checkout information:', data);
        toaster.create({
          title: "Payment Error",
          description: "Failed to create checkout session. Please try again.",
        });
        return;
      }

      if (isInIframe) {
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const parentOrigin = urlParams.get('parentOrigin') || '*';
          const checkoutUrl = clientSecret
            ? `/sponsorships/checkout?client_secret=${clientSecret}&parentOrigin=${encodeURIComponent(parentOrigin)}&embedded=true`
            : url;

          console.log('Redirecting to:', checkoutUrl);
          window.location.href = checkoutUrl;
          return;
        } catch (e) {
          console.error('[Child Frame] Error handling checkout:', e);
          toaster.create({
            title: "Payment Error",
            description: "Failed to process checkout. Please try again.",
          });
        }
      } else {
        const checkoutUrl = url || `/sponsorships/checkout?client_secret=${clientSecret}`;
        console.log('Redirecting to:', checkoutUrl);
        window.location.href = checkoutUrl;
        return;
      }
    } catch {
      toaster.create({
        title: "Payment Error",
        description: "Something went wrong. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flex minH="100vh" align="center" justify="center" bg="white" py={8}>
      <Box
        bg="white"
        borderRadius="xl"
        maxW="400px"
        w="100%"
        p={6}
        border="1px solid #E8E8EA"
      >
        <Text fontWeight="bold" fontSize="lg" textAlign="center" mb={4}>
          Become Our Partner!
        </Text>

        <Box mb={4}>
          <Text fontWeight="semibold" fontSize="sm" mb={1}>Amount</Text>
          <Flex align="center" border="1px solid #E8E8EA" borderRadius="md" mb={2}>
            <InputAddon bg="#F3F3F3" px={4} py={2} color="#959090" fontSize="md" border="none">
              $
            </InputAddon>
            <Input
              type="text"
              pattern="\d*"
              min={1}
              max={maximumAmount}
              value={inputValue}
              onChange={handleAmountChange}
              border="none"
              px={2}
              py={2}
              fontSize="md"
              _focus={{ boxShadow: "none" }}
              placeholder="Enter Amount"
            />
          </Flex>
          <Box my={2}>
            <Slider
              value={value}
              min={0}
              max={maximumAmount}
              step={5}
              variant="solid"
              onValueChange={handleSliderChange}
            />
            <Text textAlign="center" mt={2}>Selected Amount: ${value[0]}</Text>
            {amount > 0 && amount < minimumAmount && (
              <Text color="gray.400" fontSize="sm" textAlign="center" mt={1}>
                Minimum partnership amount is ${minimumAmount}.
              </Text>
            )}
          </Box>
        </Box>

        <Box mb={4}>
          <Text fontWeight="semibold" fontSize="sm" mb={1}>Email</Text>
          <Input
            className="px-2"
            type="email"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            placeholder="Enter your email"
            border="1px solid #E8E8EA"
            _focus={{ borderColor: "#1C3C8C", boxShadow: "none" }}
          />
        </Box>

        <Box mb={4}>
          <Text fontWeight="semibold" fontSize="sm" mb={1}>Frequency</Text>
          <NativeSelectRoot>
            <NativeSelectField
              className="border px-2"
              value={selectedOption}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedOption(e.target.value)}
              items={frequencyOptions}
            />
          </NativeSelectRoot>
        </Box>

        <Box mb={4}>
          <Text fontWeight="semibold" fontSize="sm" mb={1}>Choose a Project</Text>
          <NativeSelectRoot>
            <NativeSelectField
              className="border px-2"
              placeholder="Area of greatest need"
              value={project}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setProject(e.target.value)}
              items={projectOptions}
            />
          </NativeSelectRoot>
        </Box>
        <Button
          className="w-full py-2 bg-blue-700 text-white hover:bg-blue-800"
          onClick={handleSubmit}
          loading={loading}
          loadingText="Processing..."
          disabled={loading || amount < minimumAmount}
        >
          Next
        </Button>

        <Text color="gray.500" fontSize="sm" textAlign="center" mt={3}>
          Your {selectedOption === 'subscription' ? 'monthly' : 'yearly'} contribution of ${amount} helps us continue our mission of providing safety, healing, and a future full of promise for vulnerable children.
        </Text>
      </Box>
    </Flex>
  );
}
