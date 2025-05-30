"use client";
import React, { useState } from "react";
import { Box, Text, Input, Button } from "@chakra-ui/react";

interface BeneficiarySubscribeBoxProps {
  beneficiary: { name: string };
  description?: string;
}

const BeneficiarySubscribeBox: React.FC<BeneficiarySubscribeBoxProps> = ({
  beneficiary,
  description = "A spirited young girl from France discovering local delicacies.",
}) => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!email || !/^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/.test(email)) {
      setMessage({ type: "error", text: "Please enter a valid email address." });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, beneficiary: beneficiary.name }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "Subscribed! Check your inbox for updates." });
        setEmail("");
      } else {
        const data = await res.json();
        setMessage({ type: "error", text: data.error || "Subscription failed. Please try again." });
      }
    } catch {
      setMessage({ type: "error", text: "An error occurred. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box flex="1" minW="280px" bg="blue.600" color="white" p={6} borderRadius="md" boxShadow="sm" className="flex flex-col justify-center">
      <Text fontWeight="bold" fontSize="lg" mb={2}>
        Sign up to receive FREE monthly updates on {beneficiary.name}
      </Text>
      <Text fontSize="sm" mb={4}>
        {description}
      </Text>
      <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
        <label htmlFor="subscribe-email" className="text-white text-sm font-medium mb-1">
          Email Address
        </label>
        <Input
          id="subscribe-email"
          placeholder="name@email.com"
          type="email"
          bg="white"
          color="black"
          mb={2}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          required
          px={4}
        />
        <Button
          colorScheme="whiteAlpha"
          bg="white"
          color="blue.700"
          w="full"
          mt={2}
          type="submit"
          disabled={loading}
        >
          Subscribe
        </Button>
        {message && (
          <Text color={message.type === "success" ? "green.200" : "red.200"} mt={2} fontSize="sm">
            {message.text}
          </Text>
        )}
      </form>
    </Box>
  );
};

export default BeneficiarySubscribeBox;
