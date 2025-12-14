"use client"
import React, { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import {
  Box,
  Button,
  Input,
  Textarea,
  Flex,
  Text,
  Spinner,
} from "@chakra-ui/react"
import Image from "next/image"
import {
  FileUploadRoot,
  FileUploadTrigger,
  FileUploadList,
} from "@/components/ui/file-upload"
import {
  SelectRoot,
  SelectTrigger,
  SelectValueText,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { toaster } from "@/components/ui/toaster"
import { createListCollection } from "@chakra-ui/react"
import { HiUpload } from "react-icons/hi"
import { GoArrowLeft } from "react-icons/go"
import { Beneficiaries } from "@/types/admin.types"
import ProofreadButton from "@/components/ai/ProofreadButton"
import Link from "next/link"

interface SponsorInfo {
  subscriptionId: string
  userId: string | null
  email: string
  name: string | null
  amount: number | null
  interval: string | null
  emailNotification: boolean | null
}

const MessagingPage: React.FC = () => {
  const searchParams = useSearchParams()
  const router = useRouter()
  const beneficiaryIdFromUrl = searchParams.get("beneficiary_id")

  const [beneficiaries, setBeneficiaries] = useState<Beneficiaries[]>([])
  const [selectedBeneficiaryId, setSelectedBeneficiaryId] = useState<string>(
    beneficiaryIdFromUrl || "",
  )
  const [sponsors, setSponsors] = useState<SponsorInfo[]>([])
  const [selectedSponsorIds, setSelectedSponsorIds] = useState<Set<string>>(
    new Set(),
  )
  const [isPublic, setIsPublic] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [videoFiles, setVideoFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [videoPreviews, setVideoPreviews] = useState<string[]>([])
  const [loadingSponsors, setLoadingSponsors] = useState(false)
  const [saving, setSaving] = useState(false)

  // Fetch beneficiaries on mount
  useEffect(() => {
    const fetchBeneficiaries = async () => {
      try {
        const res = await fetch("/api/admin/beneficiaries/retrieve")
        const data = await res.json()
        setBeneficiaries(data.beneficiaries || [])
      } catch (error) {
        console.error("Failed to fetch beneficiaries:", error)
        toaster.create({
          title: "Error",
          description: "Failed to load beneficiaries",
          duration: 3000,
        })
      }
    }
    fetchBeneficiaries()
  }, [])

  // Fetch sponsors when beneficiary is selected
  useEffect(() => {
    const fetchSponsors = async () => {
      if (!selectedBeneficiaryId) {
        setSponsors([])
        return
      }

      setLoadingSponsors(true)
      try {
        const res = await fetch(
          `/api/admin/messaging/sponsors?beneficiary_id=${selectedBeneficiaryId}`,
        )
        const data = await res.json()
        setSponsors(data.sponsors || [])
        setSelectedSponsorIds(new Set()) // Reset selection when beneficiary changes
      } catch (error) {
        console.error("Failed to fetch sponsors:", error)
        toaster.create({
          title: "Error",
          description: "Failed to load sponsors",
          duration: 3000,
        })
      } finally {
        setLoadingSponsors(false)
      }
    }

    fetchSponsors()
  }, [selectedBeneficiaryId])

  // Update URL when beneficiary changes
  useEffect(() => {
    if (selectedBeneficiaryId) {
      router.replace(`/admin/messaging?beneficiary_id=${selectedBeneficiaryId}`)
    } else {
      router.replace("/admin/messaging")
    }
  }, [selectedBeneficiaryId, router])

  // Handle image previews
  useEffect(() => {
    const urls = imageFiles.map((file) => URL.createObjectURL(file))
    setImagePreviews(urls)

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [imageFiles])

  // Handle video previews
  useEffect(() => {
    const urls = videoFiles.map((file) => URL.createObjectURL(file))
    setVideoPreviews(urls)

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [videoFiles])

  const beneficiaryCollection = createListCollection({
    items: beneficiaries.map((b) => ({
      value: b.id,
      label: b.name || b.username || "Unknown",
    })),
  })

  const handleToggleSponsor = (subscriptionId: string) => {
    const newSet = new Set(selectedSponsorIds)
    if (newSet.has(subscriptionId)) {
      newSet.delete(subscriptionId)
    } else {
      newSet.add(subscriptionId)
    }
    setSelectedSponsorIds(newSet)
  }

  const handleSelectAllSponsors = () => {
    if (selectedSponsorIds.size === sponsors.length) {
      setSelectedSponsorIds(new Set())
    } else {
      setSelectedSponsorIds(new Set(sponsors.map((s) => s.subscriptionId)))
    }
  }

  const handleRemoveImage = (index: number) => {
    if (imagePreviews[index]) {
      URL.revokeObjectURL(imagePreviews[index])
    }
    const newFiles = imageFiles.filter((_, i) => i !== index)
    const newPreviews = imagePreviews.filter((_, i) => i !== index)
    setImageFiles(newFiles)
    setImagePreviews(newPreviews)
  }

  const handleRemoveVideo = (index: number) => {
    if (videoPreviews[index]) {
      URL.revokeObjectURL(videoPreviews[index])
    }
    const newFiles = videoFiles.filter((_, i) => i !== index)
    const newPreviews = videoPreviews.filter((_, i) => i !== index)
    setVideoFiles(newFiles)
    setVideoPreviews(newPreviews)
  }

  const handleSubmit = async () => {
    if (!selectedBeneficiaryId) {
      toaster.create({
        title: "Error",
        description: "Please select a beneficiary",
        type: "error",
        duration: 3000,
      })
      return
    }

    if (!description.trim()) {
      toaster.create({
        title: "Error",
        description: "Please enter a message",
        type: "error",
        duration: 3000,
      })
      return
    }

    setSaving(true)
    try {
      const formData = new FormData()
      formData.append("title", title)
      formData.append("description", description)
      formData.append("beneficiary_id", selectedBeneficiaryId)
      formData.append("is_public", isPublic.toString())
      formData.append(
        "selected_sponsor_ids",
        Array.from(selectedSponsorIds).join(","),
      )

      imageFiles.forEach((file) => formData.append("images", file))
      videoFiles.forEach((file) => formData.append("videos", file))

      const res = await fetch("/api/admin/messaging/create", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || "Failed to send message")
      }

      toaster.create({
        title: "Success",
        description: "Message sent successfully",
        type: "success",
        duration: 3000,
      })

      // Reset form
      setTitle("")
      setDescription("")
      setImageFiles([])
      setVideoFiles([])
      setImagePreviews([])
      setVideoPreviews([])
      setSelectedSponsorIds(new Set())
      setIsPublic(false)
    } catch (error) {
      console.error("Error sending message:", error)
      toaster.create({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to send message",
        type: "error",
        duration: 5000,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box className="min-h-screen bg-gray-50">
      {/* Header Bar - Gmail/WordPress style */}
      <Box className="bg-white border-b border-gray-200 shadow-sm">
        <Box className="max-w-7xl mx-auto px-6 py-4">
          <Flex align="center" gap={4}>
            <Button
              variant="ghost"
              onClick={() => router.push("/admin")}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 p-2"
            >
              <GoArrowLeft className="w-4 h-4" />
              <Text fontSize="sm">Back</Text>
            </Button>
            <Box className="h-6 w-px bg-gray-300" />
            <Link href="/admin" className="cursor-pointer">
              <Text
                fontSize="sm"
                color="gray.500"
                _hover={{ color: "gray.900" }}
              >
                Admin Dashboard
              </Text>
            </Link>
            <Box className="h-6 w-px bg-gray-300" />
            <Text fontSize="lg" fontWeight="600" color="gray.900">
              Compose Message
            </Text>
          </Flex>
        </Box>
      </Box>

      {/* Main Content Area - Full Screen */}
      <Box className="max-w-7xl mx-auto px-6 py-8">
        {/* Recipient Section - Gmail style */}
        <Box className="bg-white rounded-lg shadow-sm border border-gray-200 mb-4">
          <Box className="px-6 py-4 border-b border-gray-200">
            <Flex align="center" gap={4}>
              <Text className="text-sm font-medium text-gray-700 min-w-[80px]">
                To:
              </Text>
              <Box className="flex-1">
                <SelectRoot
                  collection={beneficiaryCollection}
                  className="border-0 focus:ring-0"
                  value={selectedBeneficiaryId ? [selectedBeneficiaryId] : []}
                  onValueChange={(details) =>
                    setSelectedBeneficiaryId(details.value[0] || "")
                  }
                >
                  <SelectTrigger className="w-full border-0 shadow-none focus:ring-0">
                    <SelectValueText placeholder="Select a beneficiary" />
                  </SelectTrigger>
                  <SelectContent>
                    {beneficiaryCollection.items.map((option) => (
                      <SelectItem key={option.value} item={option}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
              </Box>
            </Flex>
          </Box>

          {/* Sponsors Section */}
          {selectedBeneficiaryId && (
            <Box className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <Flex justify="space-between" align="center" className="mb-3">
                <Text className="text-sm font-medium text-gray-700">
                  Sponsors ({sponsors.length})
                </Text>
                {sponsors.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleSelectAllSponsors}
                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                  >
                    {selectedSponsorIds.size === sponsors.length
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                )}
              </Flex>
              {loadingSponsors ? (
                <Flex justify="center" className="py-4">
                  <Spinner size="sm" />
                </Flex>
              ) : sponsors.length === 0 ? (
                <Text className="text-sm text-gray-500">
                  No sponsors found for this beneficiary
                </Text>
              ) : (
                <Box className="space-y-2 max-h-64 overflow-y-auto">
                  {sponsors.map((sponsor) => (
                    <Flex
                      key={sponsor.subscriptionId}
                      align="center"
                      gap={3}
                      className="p-2 hover:bg-white rounded transition-colors"
                    >
                      <Checkbox
                        checked={selectedSponsorIds.has(
                          sponsor.subscriptionId,
                        )}
                        onCheckedChange={() =>
                          handleToggleSponsor(sponsor.subscriptionId)
                        }
                      />
                      <Box className="flex-1">
                        <Text className="text-sm font-medium text-gray-900">
                          {sponsor.name || "Unknown"}
                        </Text>
                        <Text className="text-xs text-gray-500">
                          {sponsor.email}
                        </Text>
                        {sponsor.amount && (
                          <Text className="text-xs text-gray-400">
                            ${(sponsor.amount / 100).toFixed(2)}/
                            {sponsor.interval || "month"}
                          </Text>
                        )}
                      </Box>
                      {sponsor.emailNotification === false && (
                        <Text className="text-xs text-gray-400 italic">
                          (Notifications disabled)
                        </Text>
                      )}
                    </Flex>
                  ))}
                </Box>
              )}
            </Box>
          )}

          {/* Public Visibility Toggle - Prominent and Large */}
          <Box className="px-6 py-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-200">
            <Flex align="center" gap={4}>
              <Checkbox
                checked={isPublic}
                onCheckedChange={(checked) => setIsPublic(!!checked)}
                size="lg"
                className="scale-125"
              />
              <Box className="flex-1">
                <Text className="text-base font-semibold text-gray-900 mb-1">
                  Make this message public
                </Text>
                <Text className="text-sm text-gray-600">
                  Public messages will appear on the beneficiary&apos;s profile
                  page for everyone to see
                </Text>
              </Box>
              <Box
                className={`px-4 py-2 rounded-lg font-semibold text-sm ${
                  isPublic
                    ? "bg-green-100 text-green-800"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {isPublic ? "PUBLIC" : "PRIVATE"}
              </Box>
            </Flex>
          </Box>
        </Box>

        {/* Message Composition Area - WordPress style */}
        <Box className="bg-white rounded-lg shadow-sm border border-gray-200">
          {/* Subject/Title */}
          <Box className="px-6 py-4 border-b border-gray-200">
            <Input
              placeholder="Subject (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="border-0 text-lg font-medium focus:ring-0 focus:border-0"
              fontSize="lg"
            />
            <Flex justify="flex-end" className="mt-2">
              <ProofreadButton
                text={title}
                onAccept={setTitle}
                fieldLabel="Subject"
                size="sm"
              />
            </Flex>
          </Box>

          {/* Content Editor */}
          <Box className="px-6 py-4">
            <Textarea
              placeholder="Start writing your message..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={12}
              className="border-0 focus:ring-0 resize-none text-base"
              fontSize="md"
            />
            <Flex justify="flex-end" className="mt-2">
              <ProofreadButton
                text={description}
                onAccept={setDescription}
                fieldLabel="Message"
                size="sm"
              />
            </Flex>
          </Box>

          {/* Attachments Section */}
          <Box className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <Flex gap={4} wrap="wrap">
              {/* Image Upload */}
              <Box className="flex-1 min-w-[200px]">
                <Text className="text-sm font-medium mb-2 text-gray-700">
                  Photos
                </Text>
                <FileUploadRoot
                  onFileChange={(fileDetails) => {
                    const newFiles = fileDetails.acceptedFiles
                    imagePreviews.forEach((url, index) => {
                      if (
                        !newFiles[index] ||
                        newFiles[index] !== imageFiles[index]
                      ) {
                        URL.revokeObjectURL(url)
                      }
                    })
                    const newUrls = newFiles.map((file, index) => {
                      if (
                        imageFiles[index] === file &&
                        imagePreviews[index]
                      ) {
                        return imagePreviews[index]
                      }
                      return URL.createObjectURL(file)
                    })
                    setImageFiles(newFiles)
                    setImagePreviews(newUrls)
                  }}
                  accept={["image/*"]}
                  maxFiles={10}
                >
                  <FileUploadTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-gray-300 hover:bg-gray-100"
                      px={4}
                    >
                      <HiUpload /> Upload Photos
                    </Button>
                  </FileUploadTrigger>
                  <FileUploadList showSize clearable files={imageFiles} />
                </FileUploadRoot>
              </Box>

              {/* Video Upload */}
              <Box className="flex-1 min-w-[200px]">
                <Text className="text-sm font-medium mb-2 text-gray-700">
                  Videos
                </Text>
                <FileUploadRoot
                  onFileChange={(fileDetails) => {
                    const newFiles = fileDetails.acceptedFiles
                    videoPreviews.forEach((url, index) => {
                      if (
                        !newFiles[index] ||
                        newFiles[index] !== videoFiles[index]
                      ) {
                        URL.revokeObjectURL(url)
                      }
                    })
                    const newUrls = newFiles.map((file, index) => {
                      if (
                        videoFiles[index] === file &&
                        videoPreviews[index]
                      ) {
                        return videoPreviews[index]
                      }
                      return URL.createObjectURL(file)
                    })
                    setVideoFiles(newFiles)
                    setVideoPreviews(newUrls)
                  }}
                  accept={["video/*"]}
                  maxFiles={5}
                >
                  <FileUploadTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-gray-300 hover:bg-gray-100"
                      px={4}
                    >
                      <HiUpload /> Upload Videos
                    </Button>
                  </FileUploadTrigger>
                  <FileUploadList showSize clearable files={videoFiles} />
                </FileUploadRoot>
              </Box>
            </Flex>

            {/* Image Previews */}
            {imagePreviews.length > 0 && (
              <Box className="flex flex-wrap gap-3 mt-4">
                {imagePreviews.map((src, index) => (
                  <Box
                    key={src}
                    className="relative group"
                    style={{ width: 150, height: 150 }}
                  >
                    <Box className="w-full h-full rounded-lg overflow-hidden border border-gray-200 bg-gray-100 relative">
                      <Image
                        src={src}
                        alt={`Preview ${index + 1}`}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    </Box>
                    <Button
                      onClick={() => handleRemoveImage(index)}
                      className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                      size="xs"
                    >
                      ×
                    </Button>
                  </Box>
                ))}
              </Box>
            )}

            {/* Video Previews */}
            {videoPreviews.length > 0 && (
              <Box className="flex flex-wrap gap-3 mt-4">
                {videoPreviews.map((src, index) => (
                  <Box
                    key={src}
                    className="relative group"
                    style={{ width: 240, height: 150 }}
                  >
                    <Box className="w-full h-full rounded-lg overflow-hidden border border-gray-200 bg-black">
                      <video
                        src={src}
                        controls
                        className="w-full h-full object-cover"
                      >
                        Your browser does not support the video tag.
                      </video>
                    </Box>
                    <Button
                      onClick={() => handleRemoveVideo(index)}
                      className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10"
                      size="xs"
                    >
                      ×
                    </Button>
                  </Box>
                ))}
              </Box>
            )}
          </Box>

          {/* Action Bar - Gmail style */}
          <Box className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <Flex justify="space-between" align="center">
              <Button
                variant="ghost"
                onClick={() => {
                  setTitle("")
                  setDescription("")
                  setImageFiles([])
                  setVideoFiles([])
                  setImagePreviews([])
                  setVideoPreviews([])
                  setSelectedSponsorIds(new Set())
                  setIsPublic(false)
                }}
                disabled={saving}
                className="text-gray-600 hover:text-gray-900"
              >
                Discard
              </Button>
              <Flex gap={3}>
                <Button
                  variant="outline"
                  onClick={() => router.push("/admin")}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  colorScheme="blue"
                  onClick={handleSubmit}
                  disabled={
                    !selectedBeneficiaryId || !description.trim() || saving
                  }
                  loading={saving}
                  className="px-6"
                >
                  {saving ? "Sending..." : "Send"}
                </Button>
              </Flex>
            </Flex>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export default MessagingPage
