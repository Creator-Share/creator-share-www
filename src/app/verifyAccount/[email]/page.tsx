"use client";

import { Box } from "@chakra-ui/react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/authStore";
import { useEffect } from "react";

const VerifyAccount = () => {
  const registrationEmail = useAuthStore((state) => state.registrationEmail);
  const router = useRouter();

  useEffect(() => {
    if (!registrationEmail) {
      router.push("/signin");
    }
  }, [registrationEmail, router]);

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Box
        className="w-full max-w-md p-6 bg-[#FFFFFF] md:rounded-lg md:border md:shadow-sm md:px-8 md:py-12"
      >
        <div className="flex justify-center">
          <Image width={200} height={200} alt="creator" src="/creator-text.svg" />
        </div>
        <div className="text-center my-8">
          <h1 className="text-[#03150E] font-semibold text-2xl">Account Verification</h1>
          <p className="text-[#8D9692] text-base">
            An email has been sent to <strong>{registrationEmail}</strong>. Please check your inbox to verify your account.
          </p>
        </div>
      </Box>
    </div>
  );
};

export default VerifyAccount;
