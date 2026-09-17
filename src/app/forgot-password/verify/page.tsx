"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { PasswordRecoveryVerificationForm } from "../PasswordRecoveryVerificationForm"

export default function VerifyOtp() {
  const router = useRouter()
  const [email, setEmail] = useState("")

  return (
    <PasswordRecoveryVerificationForm
      email={email}
      onEmailChange={setEmail}
      onRequestNewCode={() => router.replace("/forgot-password")}
    />
  )
}
