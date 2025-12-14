"use client"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

export default function MessagingWithBeneficiaryPage() {
  const params = useParams()
  const router = useRouter()
  const beneficiaryId = params?.beneficiaryId as string | undefined
  const [redirected, setRedirected] = useState(false)

  // Redirect to main messaging page with beneficiary_id query param
  useEffect(() => {
    if (!redirected) {
      if (beneficiaryId) {
        router.replace(`/admin/messaging?beneficiary_id=${beneficiaryId}`)
      } else {
        router.replace("/admin/messaging")
      }
      setRedirected(true)
    }
  }, [beneficiaryId, router, redirected])

  // Show loading state while redirecting
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-gray-500">Loading...</div>
    </div>
  )
}

