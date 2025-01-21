"use client";
import { Box, Stack, Button } from "@chakra-ui/react";
import Image from "next/image";
const Verified = () => {
    return (
        <div className="flex items-center justify-center min-h-screen p-4">
            <Box
                className="w-full max-w-md p-6 bg-[#FFFFFF] md:rounded-lg md:border md:shadow-sm md:px-8 md:py-12"
            >
                <div className="flex justify-center">
                    <Image width={200} height={200} alt="creator" src="/creator-text.svg" />
                </div>
                <div className="text-center my-8">
                    <h1 className="text-[#03150E] font-semibold text-2xl">Account Created</h1>
                    <p className="text-[#8D9692] text-base">
                        You have successfully created a Creator Share account.
                    </p>
                </div>
                <Stack>
                    <Button className="border bg-[#1C3C8C] text-[#FFFFFF] font-semibold text-base">Proceed to Dashboard</Button>
                    <Button className="border border-[#1C3C8C] text-[#1C3C8C] text-base font-semibold">Start a Campaign</Button>
                </Stack>
            </Box>
        </div>
    );
};

export default Verified;
