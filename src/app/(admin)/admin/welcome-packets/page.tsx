"use client"

import React, { useEffect, useState } from "react"
import { Box, Button, Input, Textarea } from "@chakra-ui/react"
import Image from "next/image"
import AdminPageLayout from "@/components/admin-ui/AdminPageLayout"
import { createClient } from "@/utils/supabase/client"
import { toaster } from "@/components/ui/toaster"
import {
  FileUploadRoot,
  FileUploadTrigger,
  FileUploadList,
} from "@/components/ui/file-upload"
import { HiUpload } from "react-icons/hi"
import ProofreadButton from "@/components/ai/ProofreadButton"

interface NewSponsor {
  subscriptionId: string
  beneficiaryId: string
  beneficiaryName: string
  beneficiaryUsername: string
  sponsorEmail: string
  sponsorName: string | null
  createdAt: string
  amount: number
  interval: string
}

const WelcomePacketsPage: React.FC = () => {
  const [newSponsors, setNewSponsors] = useState<NewSponsor[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSponsor, setSelectedSponsor] = useState<NewSponsor | null>(null)
  const [showForm, setShowForm] = useState(false)
  
  // Form state
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    const fetchNewSponsors = async () => {
      try {
        setLoading(true)
        
        // Get subscriptions from the last 30 days with status "complete"
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        
        const { data: subscriptions, error: subError } = await supabase
          .from("subscriptions")
          .select(`
            id,
            beneficiary_id,
            user_id,
            created_at,
            amount,
            interval,
            beneficiaries(id, name, username),
            users(id, email, first_name, last_name)
          `)
          .eq("status", "complete")
          .gte("created_at", thirtyDaysAgo.toISOString())
          .order("created_at", { ascending: false })

        if (subError) {
          throw subError
        }

        // Transform the data
        type SubscriptionWithRelations = {
          id: string
          beneficiary_id: string
          user_id: string | null
          created_at: string
          amount: number | null
          interval: string | null
          beneficiaries: { id: string; name: string; username: string } | { id: string; name: string; username: string }[] | null
          users: { id: string; email: string; first_name: string | null; last_name: string | null } | { id: string; email: string; first_name: string | null; last_name: string | null }[] | null
        }
        
        const transformed: NewSponsor[] = (subscriptions || [])
          .filter((sub: SubscriptionWithRelations) => {
            const beneficiary = Array.isArray(sub.beneficiaries) ? sub.beneficiaries[0] : sub.beneficiaries
            return beneficiary && sub.user_id
          })
          .map((sub: SubscriptionWithRelations) => {
            // Handle beneficiary data - may be array or object
            const beneficiary = Array.isArray(sub.beneficiaries)
              ? sub.beneficiaries[0]
              : sub.beneficiaries
            
            // Handle user data - may be array or object
            const user = Array.isArray(sub.users)
              ? sub.users[0]
              : sub.users
            
            const sponsorEmail = user?.email || `User ID: ${sub.user_id}`
            const sponsorName = user?.first_name && user?.last_name
              ? `${user.first_name} ${user.last_name}`
              : user?.first_name || user?.last_name || null

            return {
              subscriptionId: sub.id,
              beneficiaryId: sub.beneficiary_id,
              beneficiaryName: beneficiary?.name || "Unknown",
              beneficiaryUsername: beneficiary?.username || "unknown",
              sponsorEmail,
              sponsorName,
              createdAt: sub.created_at,
              amount: sub.amount || 0,
              interval: sub.interval || "month",
            }
          })

        setNewSponsors(transformed)
      } catch (err) {
        console.error("Error fetching new sponsors:", err)
        toaster.create({
          title: "Error",
          description: "Failed to load new sponsors",
          type: "error",
          duration: 3000,
        })
      } finally {
        setLoading(false)
      }
    }

    fetchNewSponsors()
  }, [supabase])

  const handleSelectSponsor = (sponsor: NewSponsor) => {
    setSelectedSponsor(sponsor)
    setShowForm(true)
    // Pre-fill form with welcome message
    setTitle(`Welcome Packet for ${sponsor.beneficiaryName}`)
    setDescription(
      `We're excited to share that ${sponsor.beneficiaryName} has been sponsored! Here are some recent photos and updates.`
    )
    setImageFiles([])
    setError(null)
  }

  const handleCreateWelcomePacket = async () => {
    if (!selectedSponsor) return

    if (!title.trim() || !description.trim()) {
      setError("Title and description are required")
      return
    }

    if (imageFiles.length === 0) {
      setError("Please upload at least one image")
      return
    }

    setCreating(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append("title", title)
      formData.append("description", description)
      formData.append("activity_type", "UPDATE")
      formData.append("activity_source", "admin")
      formData.append("beneficiary_id", selectedSponsor.beneficiaryId)
      
      // Add images
      imageFiles.forEach((file) => formData.append("images", file))

      const res = await fetch("/api/admin/activities/create", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Failed to create welcome packet" }))
        throw new Error(errorData.error || "Failed to create welcome packet")
      }

      toaster.create({
        title: "Success",
        description: `Welcome packet created and shared with ${selectedSponsor.sponsorEmail}`,
        type: "success",
        duration: 5000,
      })

      // Reset form
      setSelectedSponsor(null)
      setShowForm(false)
      setTitle("")
      setDescription("")
      // Clean up preview URLs
      imagePreviewUrls.forEach(url => URL.revokeObjectURL(url))
      setImageFiles([])
      setImagePreviewUrls([])
      
      // Remove the sponsor from the list (optional - you might want to keep them)
      setNewSponsors((prev) =>
        prev.filter((s) => s.subscriptionId !== selectedSponsor.subscriptionId)
      )
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to create welcome packet"
      setError(errorMessage)
      toaster.create({
        title: "Error",
        description: errorMessage,
        type: "error",
        duration: 5000,
      })
    } finally {
      setCreating(false)
    }
  }

  return (
    <AdminPageLayout
      title="Welcome Packets"
      description="Share welcome packets with new sponsors, including photos of recently sponsored children"
      breadcrumb={[{ label: "Welcome Packets" }]}
      searchValue=""
      onSearchChange={() => {}}
      showResults={true}
    >
      <Box className="container mx-auto py-8">
        {loading ? (
          <div className="text-center py-8">
            <div className="text-lg">Loading new sponsors...</div>
          </div>
        ) : newSponsors.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-lg">No new sponsors found</div>
            <div className="text-sm text-gray-500 mt-2">
              New sponsors from the last 30 days will appear here
            </div>
          </div>
        ) : !showForm ? (
          <div className="space-y-4">
            <div className="mb-6">
              <h2 className="text-xl font-semibold mb-2">
                New Sponsors ({newSponsors.length})
              </h2>
              <p className="text-sm text-gray-600">
                Select a sponsor to create and share a welcome packet with photos
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {newSponsors.map((sponsor) => (
                <div
                  key={sponsor.subscriptionId}
                  className="border border-gray-200 rounded-lg p-4 hover:border-blue-500 hover:shadow-md transition-all cursor-pointer"
                  onClick={() => handleSelectSponsor(sponsor)}
                >
                  <div className="font-semibold text-lg mb-2">
                    {sponsor.beneficiaryName}
                  </div>
                  <div className="text-sm text-gray-600 mb-2">
                    Sponsored by: {sponsor.sponsorName || sponsor.sponsorEmail}
                  </div>
                  <div className="text-xs text-gray-500">
                    ${(sponsor.amount / 100).toFixed(2)}/{sponsor.interval} •{" "}
                    {new Date(sponsor.createdAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="mb-6">
                <h2 className="text-xl font-semibold mb-2">Create Welcome Packet</h2>
                <div className="text-sm text-gray-600 mb-4">
                  <div>
                    <strong>Child:</strong> {selectedSponsor?.beneficiaryName}
                  </div>
                  <div>
                    <strong>Sponsor:</strong> {selectedSponsor?.sponsorName || selectedSponsor?.sponsorEmail}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowForm(false)
                    setSelectedSponsor(null)
                    setError(null)
                    // Clean up preview URLs
                    imagePreviewUrls.forEach(url => URL.revokeObjectURL(url))
                    setImageFiles([])
                    setImagePreviewUrls([])
                  }}
                >
                  ← Back to List
                </Button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Title</label>
                  <Input
                    placeholder="Welcome Packet Title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="border border-stone-600"
                  />
                  <div className="flex justify-end mt-2">
                    <ProofreadButton
                      text={title}
                      onAccept={setTitle}
                      fieldLabel="Title"
                      size="sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Description
                  </label>
                  <Textarea
                    placeholder="Welcome message and updates..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={6}
                    className="border border-stone-600"
                  />
                  <div className="flex justify-end mt-2">
                    <ProofreadButton
                      text={description}
                      onAccept={setDescription}
                      fieldLabel="Description"
                      size="sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Upload Images (Required)
                  </label>
                  <p className="text-xs text-gray-500 mb-2">
                    Upload photos of the child to share with the new sponsor
                  </p>
                  <FileUploadRoot
                    onFileChange={(fileDetails) => {
                      const newFiles = fileDetails.acceptedFiles
                      setImageFiles(newFiles)
                      
                      // Clean up old preview URLs
                      imagePreviewUrls.forEach(url => URL.revokeObjectURL(url))
                      
                      // Create new preview URLs
                      const newUrls = newFiles.map(file => URL.createObjectURL(file))
                      setImagePreviewUrls(newUrls)
                    }}
                    accept={["image/*"]}
                    maxFiles={10}
                  >
                    <FileUploadTrigger asChild>
                      <Button variant="outline" size="sm" className="border" px={4}>
                        <HiUpload /> Upload Images
                      </Button>
                    </FileUploadTrigger>
                    <FileUploadList showSize clearable />
                  </FileUploadRoot>
                  
                  {/* Image Previews */}
                  {imageFiles.length > 0 && (
                    <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-4">
                      {imageFiles.map((file, index) => (
                        <div key={`${file.name}-${index}`} className="relative group">
                          <div className="aspect-square rounded-lg overflow-hidden border border-gray-200 bg-gray-50 relative">
                            <Image
                              src={imagePreviewUrls[index]}
                              alt={`Preview ${index + 1}`}
                              fill
                              className="object-cover"
                              unoptimized
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              // Revoke the URL for this image
                              if (imagePreviewUrls[index]) {
                                URL.revokeObjectURL(imagePreviewUrls[index])
                              }
                              
                              // Remove from arrays
                              const newFiles = imageFiles.filter((_, i) => i !== index)
                              const newUrls = imagePreviewUrls.filter((_, i) => i !== index)
                              
                              setImageFiles(newFiles)
                              setImagePreviewUrls(newUrls)
                            }}
                            className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                            aria-label="Remove image"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                          </button>
                          <div className="mt-1 text-xs text-gray-500 truncate">
                            {file.name}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {error && (
                  <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
                    {error}
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-4">
                  <Button
                    onClick={() => {
                      setShowForm(false)
                      setSelectedSponsor(null)
                      setError(null)
                    }}
                    disabled={creating}
                  >
                    Cancel
                  </Button>
                  <Button
                    colorScheme="blue"
                    onClick={handleCreateWelcomePacket}
                    disabled={!title.trim() || !description.trim() || imageFiles.length === 0 || creating}
                  >
                    {creating ? "Creating..." : "Create & Share Welcome Packet"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </Box>
    </AdminPageLayout>
  )
}

export default WelcomePacketsPage

