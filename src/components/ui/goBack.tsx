"use client"
import React from "react"
import { Button } from "@chakra-ui/react"
import { RiArrowGoBackLine } from "react-icons/ri"
import { useRouter } from "next/navigation"

const GoBackButton: React.FC = () => {
  const router = useRouter()

  return (
    <Button
      variant="solid"
      onClick={() => router.back()}
      className="hover:bg-[#929da8] p-4 hover:text-white"
    >
      <RiArrowGoBackLine /> Go Back
    </Button>
  )
}

export default GoBackButton
