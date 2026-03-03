import React, { useEffect, useState } from "react"
import {
  Button,
  Input,
  Textarea,
  createListCollection,
  Box,
  Flex,
  Text,
  Spinner,
} from "@chakra-ui/react"
import Image from "next/image"
import { Activity } from "@/types/admin.types"
import ProofreadButton from "@/components/ai/ProofreadButton"
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
import { HiUpload } from "react-icons/hi"
import { createClient } from "@/utils/supabase/client"
import { compressImage } from "@/utils/imageCompression"
import { toaster } from "@/components/ui/toaster"

const activityTypeCollection = createListCollection({
  items: [
    { value: "INFO", label: "INFO" },
    { value: "UPDATE", label: "UPDATE" },
    { value: "SUBSCRIPTION", label: "SUBSCRIPTION" },
  ],
})

interface SponsorInfo {
  subscriptionId: string
  userId: string | null
  emailRedacted: string
  name: string | null
  amount: number | null
  interval: string | null
  emailNotification: boolean | null
}

// ─────────────────────────────────────────────────────────────────────────────
// CreateActivityModal
// ─────────────────────────────────────────────────────────────────────────────

interface CreateModalProps {
  open: boolean
  onClose: () => void
  title: string
  description: string
  activityType: string
  beneficiaryId: string
  beneficiaryName: string
  onTitleChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onActivityTypeChange: (v: string) => void
  onComplete?: () => void
}

export const CreateActivityModal: React.FC<CreateModalProps> = ({
  open,
  onClose,
  title,
  description,
  activityType,
  beneficiaryId,
  beneficiaryName,
  // onTitleChange,
  onDescriptionChange,
  // onActivityTypeChange,
  onComplete,
}) => {
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [videoFiles, setVideoFiles] = useState<File[]>([])
  const [documentFiles, setDocumentFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [videoPreviews, setVideoPreviews] = useState<string[]>([])
  // Keys used to force-remount FileUploadRoot after each selection, clearing
  // Chakra's internal accumulated file list so re-selections start fresh.
  const [imageUploadKey, setImageUploadKey] = useState(0)
  const [videoUploadKey, setVideoUploadKey] = useState(0)
  const [documentUploadKey, setDocumentUploadKey] = useState(0)

  const [isPublic, setIsPublic] = useState(true)
  const [sendToSponsors, setSendToSponsors] = useState(true)
  const [sponsors, setSponsors] = useState<SponsorInfo[]>([])
  const [selectedSponsorIds, setSelectedSponsorIds] = useState<Set<string>>(new Set())
  const [loadingSponsors, setLoadingSponsors] = useState(false)
  const [status, setStatus] = useState<"idle" | "compressing" | "creating" | "uploading">("idle")
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    if (!open) {
      setImageFiles([])
      setVideoFiles([])
      setDocumentFiles([])
      setImagePreviews([])
      setVideoPreviews([])
      setImageUploadKey((k) => k + 1)
      setVideoUploadKey((k) => k + 1)
      setDocumentUploadKey((k) => k + 1)
      setIsPublic(true)
      setSendToSponsors(true)
      setSponsors([])
      setSelectedSponsorIds(new Set())
      setError(null)
    }
  }, [open])

  useEffect(() => {
    const fetchSponsors = async () => {
      if (!open || !beneficiaryId || !sendToSponsors) {
        setSponsors([])
        return
      }
      setLoadingSponsors(true)
      try {
        const res = await fetch(
          `/api/admin/messaging/sponsors?beneficiary_id=${beneficiaryId}`,
        )
        const data = await res.json()
        setSponsors(data.sponsors || [])
        setSelectedSponsorIds(
          new Set((data.sponsors || []).map((s: SponsorInfo) => s.subscriptionId)),
        )
      } catch (err) {
        console.error("Failed to fetch sponsors:", err)
        setSponsors([])
      } finally {
        setLoadingSponsors(false)
      }
    }
    fetchSponsors()
  }, [open, beneficiaryId, sendToSponsors, supabase])

  useEffect(() => {
    if (open) {
      const originalStyle = window.getComputedStyle(document.body).overflow
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = originalStyle
      }
    }
  }, [open])

  // useEffect manages all preview URL lifecycle — creation and cleanup
  useEffect(() => {
    const urls = imageFiles.map((f) => URL.createObjectURL(f))
    setImagePreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [imageFiles])

  useEffect(() => {
    const urls = videoFiles.map((f) => URL.createObjectURL(f))
    setVideoPreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [videoFiles])

  // Only update the file array — the useEffect above handles previews
  const handleRemoveImage = (index: number) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleRemoveVideo = (index: number) => {
    setVideoFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleToggleSponsor = (subscriptionId: string) => {
    setSelectedSponsorIds((prev) => {
      const next = new Set(prev)
      if (next.has(subscriptionId)) next.delete(subscriptionId)
      else next.add(subscriptionId)
      return next
    })
  }

  const handleSelectAllSponsors = () => {
    if (selectedSponsorIds.size === sponsors.length) {
      setSelectedSponsorIds(new Set())
    } else {
      setSelectedSponsorIds(new Set(sponsors.map((s) => s.subscriptionId)))
    }
  }

  const busy = status !== "idle"

  const handleCreate = async () => {
    setError(null)
    setStatus("compressing")

    try {
      // ── Step 1: Compress images & prepare all file metadata BEFORE creating
      //    the activity. If compression or any pre-flight step fails, no DB
      //    record is created and no email is sent.
      const readyFiles: File[] = []
      const readyMetadata: Array<{
        type: "IMAGE" | "VIDEO"
        extension: string
        contentType: string
      }> = []

      if (imageFiles.length > 0) {
        const { compressImages } = await import("@/utils/imageCompression")
        const compressed = await compressImages(imageFiles, { maxSizeMB: 3.5 })
        for (const file of compressed) {
          readyFiles.push(file)
          readyMetadata.push({
            type: "IMAGE",
            extension: (file.name.split(".").pop() || "jpg").toLowerCase(),
            contentType: file.type || "image/jpeg",
          })
        }
      }

      // Videos cannot be compressed in-browser; add them as-is.
      for (const file of videoFiles) {
        readyFiles.push(file)
        readyMetadata.push({
          type: "VIDEO",
          extension: (file.name.split(".").pop() || "mp4").toLowerCase(),
          contentType: file.type || "video/mp4",
        })
      }

      // ── Step 2: Create activity record ─────────────────────────────────────
      setStatus("creating")
      const createResponse = await fetch("/api/admin/activities/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          activity_type: activityType,
          activity_source: "admin",
          beneficiary_id: beneficiaryId,
          is_public: isPublic,
          selected_sponsor_ids: sendToSponsors ? Array.from(selectedSponsorIds) : [],
        }),
      })

      if (!createResponse.ok) {
        const errorData = await createResponse.json()
        throw new Error(errorData.error || "Failed to create activity")
      }

      const { activityId } = (await createResponse.json()) as { activityId: string }

      // Track whether any upload fails so we can roll back the activity.
      let mediaUploadFailed = false
      let mediaErrorMessage: string | null = null

      // ── Step 3: Upload images + videos directly to Supabase (no Vercel limit) ─
      setStatus("uploading")
      if (readyFiles.length > 0) {
        try {
          // Register DB media records → get storage keys
          const createMediaRes = await fetch("/api/admin/activities/media/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ activityId, media: readyMetadata }),
          })

          if (!createMediaRes.ok) {
            const errorText = await createMediaRes.text()
            let friendly = errorText?.trim() || "Failed to register media records"
            if (friendly.startsWith("{")) {
              try {
                const parsed = JSON.parse(friendly) as { error?: string }
                if (parsed?.error) friendly = parsed.error
              } catch { /* ignore */ }
            }
            mediaUploadFailed = true
            mediaErrorMessage = `Media upload failed: ${friendly}`
          } else {
            const { media: mediaRecords } = (await createMediaRes.json()) as {
              media: Array<{ id: string; storageKey: string; type: string; contentType: string }>
            }

            const { STORAGE_BUCKET } = await import("@/utils/supabase/buckets")
            for (let i = 0; i < readyFiles.length; i++) {
              const file = readyFiles[i]
              const record = mediaRecords[i]
              if (!record) continue
              const { error: uploadErr } = await supabase.storage
                .from(STORAGE_BUCKET)
                .upload(record.storageKey, file, {
                  contentType: record.contentType,
                  upsert: false,
                })
              if (uploadErr) {
                console.error("❌ [ACTIVITY MEDIA] Direct upload error:", uploadErr)
                mediaUploadFailed = true
                mediaErrorMessage = `Media upload failed: ${uploadErr.message}`
                break
              }
            }
          }
        } catch (err) {
          console.error("Activity media upload error:", err)
          mediaUploadFailed = true
          mediaErrorMessage = `Media upload failed: ${err instanceof Error ? err.message : "Unknown error"}`
        }
      }

      // ── Step 3b: Upload documents directly to Supabase ─────────────────────
      if (!mediaUploadFailed && documentFiles.length > 0) {
        try {
          const { STORAGE_BUCKET } = await import("@/utils/supabase/buckets")
          for (const file of documentFiles) {
            try {
              const ext = (file.name.split(".").pop() || "").toLowerCase()
              const { data: mediaRecord, error: mediaInsertErr } = await supabase
                .from("media")
                .insert([{ parent_id: activityId, extension: ext, type: "DOCUMENT" }])
                .select()
                .single()

              if (mediaInsertErr || !mediaRecord) {
                console.error("❌ [DOCUMENT UPLOAD] DB insert failed:", mediaInsertErr)
                continue
              }

              const { getStorageKey } = await import("@/utils/supabase/media")
              const storageKey = getStorageKey(
                mediaRecord as unknown as import("@/utils/supabase/media").MediaRow,
              )

              const { error: uploadErr } = await supabase.storage
                .from(STORAGE_BUCKET)
                .upload(storageKey, file, {
                  contentType: file.type || "application/pdf",
                  upsert: false,
                })

              if (uploadErr) {
                console.error("❌ [DOCUMENT UPLOAD] Storage upload failed:", uploadErr)
                await supabase.from("media").delete().eq("id", mediaRecord.id)
                mediaUploadFailed = true
                if (!mediaErrorMessage) {
                  mediaErrorMessage = `Document upload failed: ${uploadErr.message || "Unknown error"}`
                }
              }
            } catch (err) {
              console.error("❌ [DOCUMENT UPLOAD] Error uploading document:", err)
            }
          }
        } catch (err) {
          console.error("❌ [DOCUMENT UPLOAD] Fatal error:", err)
          mediaUploadFailed = true
          if (!mediaErrorMessage) {
            mediaErrorMessage = `Document upload failed: ${err instanceof Error ? err.message : "Unknown error"}`
          }
        }
      }

      // ── Roll back if any upload failed — no email is sent ──────────────────
      if (mediaUploadFailed) {
        try {
          await fetch("/api/admin/activities/delete", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: activityId }),
          })
        } catch (rollbackErr) {
          console.error("Failed to rollback activity:", rollbackErr)
        }

        const message =
          mediaErrorMessage ||
          "One or more file uploads failed. This activity was not created. Please try again."
        setError(message)
        toaster.create({ title: "Error", description: message, type: "error", duration: 8000 })
        return
      }

      // ── Step 4: Send email notifications (only reached if all uploads succeeded) ─
      if (sendToSponsors && selectedSponsorIds.size > 0) {
        try {
          await fetch("/api/admin/activities/notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              activityId,
              beneficiaryId,
              selectedSponsorIds: Array.from(selectedSponsorIds),
            }),
          })
        } catch (err) {
          console.error("Failed to send email notifications:", err)
          toaster.create({
            title: "Warning",
            description: "Activity created but email notifications failed to send.",
            type: "warning",
            duration: 5000,
          })
        }
      }

      toaster.create({
        title: "Success",
        description: "Activity created successfully",
        type: "success",
        duration: 5000,
      })
      onComplete?.()
    } catch (err) {
      console.error("Error creating activity:", err)
      const message = err instanceof Error ? err.message : "Failed to create activity"
      setError(message)
      toaster.create({ title: "Error", description: message, type: "error", duration: 5000 })
    } finally {
      setStatus("idle")
    }
  }

  if (!open) return null

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.4)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "white",
          padding: 24,
          borderRadius: 8,
          width: "min(1200px, 90vw)",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ fontWeight: "bold", fontSize: "1.125rem", marginBottom: 16 }}>
          Create Activity for {beneficiaryName}
        </div>

        {/* Public/Private Toggle */}
        <div style={{ marginBottom: 12, padding: 12, background: "#f3f4f6", borderRadius: 8 }}>
          <Flex align="center" gap={3}>
            <Checkbox checked={isPublic} onCheckedChange={(checked) => setIsPublic(!!checked)} />
            <Box flex={1}>
              <Text fontWeight="semibold" fontSize="sm">Make this activity public</Text>
              <Text fontSize="xs" color="gray.600">Public activities appear on the beneficiary&apos;s profile page</Text>
            </Box>
            <Box px={2} py={1} borderRadius={4} fontWeight="semibold" fontSize="xs"
              bg={isPublic ? "green.100" : "gray.200"} color={isPublic ? "green.800" : "gray.600"}>
              {isPublic ? "PUBLIC" : "PRIVATE"}
            </Box>
          </Flex>
        </div>

        {/* Send to Sponsors Toggle */}
        <div style={{ marginBottom: 12, padding: 12, background: "#eff6ff", borderRadius: 8 }}>
          <Flex align="center" gap={3}>
            <Checkbox checked={sendToSponsors} onCheckedChange={(checked) => setSendToSponsors(!!checked)} />
            <Box flex={1}>
              <Text fontWeight="semibold" fontSize="sm">Send email notifications to sponsors</Text>
              <Text fontSize="xs" color="gray.600">Email this update to selected sponsors</Text>
            </Box>
          </Flex>

          {sendToSponsors && (
            <Box mt={3} p={3} bg="white" borderRadius={6} border="1px solid #e5e7eb">
              <Flex justify="space-between" align="center" mb={2}>
                <Text fontSize="sm" fontWeight="medium">Sponsors ({sponsors.length})</Text>
                {sponsors.length > 0 && (
                  <Button size="xs" variant="ghost" onClick={handleSelectAllSponsors} colorScheme="blue">
                    {selectedSponsorIds.size === sponsors.length ? "Deselect All" : "Select All"}
                  </Button>
                )}
              </Flex>
              {loadingSponsors ? (
                <Flex justify="center" py={4}><Spinner size="sm" /></Flex>
              ) : sponsors.length === 0 ? (
                <Text fontSize="sm" color="gray.500">No sponsors found for this beneficiary</Text>
              ) : (
                <Box maxH="200px" overflowY="auto" className="space-y-2">
                  {sponsors.map((sponsor) => (
                    <Flex key={sponsor.subscriptionId} align="center" gap={2} p={2} borderRadius={4} _hover={{ bg: "gray.50" }}>
                      <Checkbox
                        checked={selectedSponsorIds.has(sponsor.subscriptionId)}
                        onCheckedChange={() => handleToggleSponsor(sponsor.subscriptionId)}
                      />
                      <Box flex={1}>
                        <Text fontSize="sm" fontWeight="medium">{sponsor.name || "Unknown"}</Text>
                        <Text fontSize="xs" color="gray.500">{sponsor.emailRedacted}</Text>
                      </Box>
                      {sponsor.emailNotification === false && (
                        <Text fontSize="xs" color="gray.400" fontStyle="italic">(Notifications disabled)</Text>
                      )}
                    </Flex>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </div>

        {/* <SelectRoot
          collection={activityTypeCollection}
          className="border border-stone-600"
          style={{ marginBottom: 12 }}
          value={[activityType]}
          onValueChange={(details) => onActivityTypeChange(details.value[0])}
        >
          <SelectTrigger className="w-full"><SelectValueText placeholder="Select Activity Type" /></SelectTrigger>
          <SelectContent>
            {activityTypeCollection.items.map((option) => (
              <SelectItem key={option.value} item={option}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </SelectRoot> */}

        {/* <div style={{ marginBottom: 12 }}>
          <Input placeholder="Title" value={title} onChange={(e) => onTitleChange(e.target.value)} p={2} className="border border-stone-600" />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <ProofreadButton text={title} onAccept={onTitleChange} fieldLabel="Title" size="sm" type="activity" />
          </div>
        </div> */}

        <div style={{ marginBottom: 12 }}>
          <Textarea placeholder="Description" value={description} onChange={(e) => onDescriptionChange(e.target.value)} p={2} className="border border-stone-600" />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <ProofreadButton text={description} onAccept={onDescriptionChange} fieldLabel="Description" size="sm" type="activity" />
          </div>
        </div>

        {/* Upload Images */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 500 }}>Upload Images</label>
          <FileUploadRoot
            key={imageUploadKey}
            onFileChange={(fileDetails) => {
              // Ignore the remount-init call that fires with no files
              if (fileDetails.acceptedFiles.length === 0 && fileDetails.rejectedFiles.length === 0) return
              if (fileDetails.rejectedFiles.length > 0) {
                toaster.create({
                  title: "Too many images",
                  description: "Maximum of 5 images, 2 videos, and 5 PDF files allowed.",
                  type: "error",
                  duration: 5000,
                })
              }
              setImageFiles(fileDetails.acceptedFiles)
              // Force-remount so next selection starts fresh (no accumulation)
              setImageUploadKey((k) => k + 1)
            }}
            accept={["image/*"]}
            maxFiles={5}
          >
            <FileUploadTrigger asChild>
              <Button variant="outline" size="sm" className="border" px={4}><HiUpload /> Upload Images</Button>
            </FileUploadTrigger>
            <FileUploadList showSize clearable files={imageFiles} />
          </FileUploadRoot>
          {imagePreviews.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {imagePreviews.map((src, index) => (
                <div key={src} className="relative group" style={{ width: 150, height: 150 }}>
                  <div style={{ width: "100%", height: "100%", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb", backgroundColor: "#f9fafb", position: "relative" }}>
                    <Image src={src} alt={`Preview ${index + 1}`} fill className="object-cover" unoptimized />
                  </div>
                  <button onClick={() => handleRemoveImage(index)} className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600" type="button" aria-label="Remove image">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upload Videos */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 500 }}>Upload Videos</label>
          <FileUploadRoot
            key={videoUploadKey}
            onFileChange={(fileDetails) => {
              if (fileDetails.acceptedFiles.length === 0 && fileDetails.rejectedFiles.length === 0) return
              if (fileDetails.rejectedFiles.length > 0) {
                toaster.create({
                  title: "Too many videos",
                  description: "Maximum of 5 images, 2 videos, and 5 PDF files allowed.",
                  type: "error",
                  duration: 5000,
                })
              }
              setVideoFiles(fileDetails.acceptedFiles)
              setVideoUploadKey((k) => k + 1)
            }}
            accept={["video/*"]}
            maxFiles={2}
          >
            <FileUploadTrigger asChild>
              <Button variant="outline" size="sm" className="border" px={4}><HiUpload /> Upload Videos</Button>
            </FileUploadTrigger>
            <FileUploadList showSize clearable files={videoFiles} />
          </FileUploadRoot>
          {videoPreviews.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {videoPreviews.map((src, index) => (
                <div key={src} className="relative group" style={{ width: 240, height: 150 }}>
                  <div style={{ width: "100%", height: "100%", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb", backgroundColor: "#000" }}>
                    <video src={src} controls style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}>Your browser does not support the video tag.</video>
                  </div>
                  <button onClick={() => handleRemoveVideo(index)} className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10" type="button" aria-label="Remove video">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upload Documents */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 500 }}>Upload Documents (PDFs, etc.)</label>
          <FileUploadRoot
            key={documentUploadKey}
            onFileChange={(fileDetails) => {
              if (fileDetails.acceptedFiles.length === 0 && fileDetails.rejectedFiles.length === 0) return
              if (fileDetails.rejectedFiles.length > 0) {
                toaster.create({
                  title: "Too many documents",
                  description: "Maximum of 5 images, 2 videos, and 5 PDF files allowed.",
                  type: "error",
                  duration: 5000,
                })
              }
              setDocumentFiles(fileDetails.acceptedFiles)
              setDocumentUploadKey((k) => k + 1)
            }}
            accept={["application/pdf", ".pdf"]}
            maxFiles={5}
          >
            <FileUploadTrigger asChild>
              <Button variant="outline" size="sm" className="border" px={4}><HiUpload /> Upload Documents</Button>
            </FileUploadTrigger>
            <FileUploadList showSize clearable files={documentFiles} />
          </FileUploadRoot>
          {documentFiles.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {documentFiles.map((file, index) => (
                <div key={file.name} style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 8, backgroundColor: "#f9fafb", display: "flex", alignItems: "center", gap: 8 }}>
                  <svg className="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                  </svg>
                  <div style={{ flex: 1 }}>
                    <Text fontSize="sm" fontWeight="medium">{file.name}</Text>
                    <Text fontSize="xs" color="gray.500">{(file.size / 1024 / 1024).toFixed(2)} MB</Text>
                  </div>
                  <button onClick={() => setDocumentFiles((prev) => prev.filter((_, i) => i !== index))} className="text-red-500 hover:text-red-600" type="button" aria-label="Remove document">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <div style={{ color: "red", marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <Button onClick={onClose} style={{ marginRight: 12 }} disabled={busy}>Cancel</Button>
          <Button colorScheme="blue" onClick={handleCreate} disabled={!description || busy}>
            {status === "compressing"
              ? "Compressing..."
              : status === "creating"
                ? "Creating..."
                : status === "uploading"
                  ? "Uploading..."
                  : "Create"}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EditActivityModal
// ─────────────────────────────────────────────────────────────────────────────

interface EditModalProps {
  open: boolean
  onClose: () => void
  activity: Activity | null
  /** Called after a successful save so the parent can refresh data. */
  onComplete?: () => void
}

export const EditActivityModal: React.FC<EditModalProps> = ({
  open,
  onClose,
  activity,
  onComplete,
}) => {
  const [title, setTitle] = useState(activity?.title || "")
  const [description, setDescription] = useState(activity?.description || "")
  const [activityType, setActivityType] = useState<"INFO" | "UPDATE" | "SUBSCRIPTION">(
    activity?.activity_type || "UPDATE",
  )
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [videoFiles, setVideoFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [videoPreviews, setVideoPreviews] = useState<string[]>([])
  const [existingImages, setExistingImages] = useState<string[]>(activity?.images_url || [])
  const [existingVideos, setExistingVideos] = useState<string[]>(activity?.videos_url || [])
  const [isPublic, setIsPublic] = useState(activity?.is_public || false)
  const [compressing, setCompressing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imageUploadKey, setImageUploadKey] = useState(0)
  const [videoUploadKey, setVideoUploadKey] = useState(0)

  const supabase = createClient()

  useEffect(() => {
    if (activity) {
      setTitle(activity.title || "")
      setDescription(activity.description || "")
      setActivityType(activity.activity_type || "UPDATE")
      setExistingImages(activity.images_url || [])
      setExistingVideos(activity.videos_url || [])
      setIsPublic(activity.is_public || false)
    }
  }, [activity])

  useEffect(() => {
    if (!open) {
      setImageFiles([])
      setVideoFiles([])
      setImagePreviews([])
      setVideoPreviews([])
      setImageUploadKey((k) => k + 1)
      setVideoUploadKey((k) => k + 1)
      setSaving(false)
      setError(null)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      const originalStyle = window.getComputedStyle(document.body).overflow
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = originalStyle
      }
    }
  }, [open])

  // useEffect manages all preview URL lifecycle — creation and cleanup
  useEffect(() => {
    const urls = imageFiles.map((f) => URL.createObjectURL(f))
    setImagePreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [imageFiles])

  useEffect(() => {
    const urls = videoFiles.map((f) => URL.createObjectURL(f))
    setVideoPreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [videoFiles])

  // Only update the file array — the useEffect above handles previews
  const handleRemoveImage = (index: number) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleRemoveVideo = (index: number) => {
    setVideoFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleRemoveExistingImage = (index: number) =>
    setExistingImages((prev) => prev.filter((_, i) => i !== index))

  const handleRemoveExistingVideo = (index: number) =>
    setExistingVideos((prev) => prev.filter((_, i) => i !== index))

  const handleSave = async () => {
    if (!activity) return

    setSaving(true)
    setError(null)
    setCompressing(true)

    try {
      // ── Step 1: Update activity record + delete removed media (JSON, no files) ─
      const updateRes = await fetch("/api/admin/activities/update", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activity.id,
          title,
          description,
          activity_type: activityType,
          is_public: isPublic,
          beneficiary_id: activity.beneficiary_id,
          existing_images: existingImages,
          existing_videos: existingVideos,
        }),
      })

      if (!updateRes.ok) {
        const errData = (await updateRes.json()) as { error?: string }
        throw new Error(errData.error || "Failed to update activity")
      }

      // ── Step 2: Upload new media directly to Supabase (no Vercel limit) ────
      if (imageFiles.length > 0 || videoFiles.length > 0) {
        const allFiles: File[] = []
        const allMetadata: Array<{
          type: "IMAGE" | "VIDEO"
          extension: string
          contentType: string
        }> = []

        if (imageFiles.length > 0) {
          const compressedImages: File[] = []
          const largeFiles: string[] = []

          for (const file of imageFiles) {
            try {
              const compressed = await compressImage(file, { maxSizeMB: 3.5 })
              if (compressed.size < file.size) {
                const reduction = ((1 - compressed.size / file.size) * 100).toFixed(0)
                largeFiles.push(`${file.name} (${reduction}% smaller)`)
              }
              compressedImages.push(compressed)
            } catch {
              compressedImages.push(file)
            }
          }

          if (largeFiles.length > 0) {
            toaster.create({
              title: "Large Files Compressed",
              description: `These files were automatically compressed: ${largeFiles.join(", ")}`,
              type: "info",
              duration: 5000,
            })
          }

          for (const file of compressedImages) {
            allFiles.push(file)
            allMetadata.push({
              type: "IMAGE",
              extension: (file.name.split(".").pop() || "jpg").toLowerCase(),
              contentType: file.type || "image/jpeg",
            })
          }
        }

        for (const file of videoFiles) {
          allFiles.push(file)
          allMetadata.push({
            type: "VIDEO",
            extension: (file.name.split(".").pop() || "mp4").toLowerCase(),
            contentType: file.type || "video/mp4",
          })
        }

        setCompressing(false)

        const createMediaRes = await fetch("/api/admin/activities/media/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activityId: activity.id, media: allMetadata }),
        })

        if (!createMediaRes.ok) {
          const errData = (await createMediaRes.json()) as { error?: string }
          throw new Error(errData.error || "Failed to register media records")
        }

        const { media: mediaRecords } = (await createMediaRes.json()) as {
          media: Array<{ id: string; storageKey: string; type: string; contentType: string }>
        }

        const { STORAGE_BUCKET } = await import("@/utils/supabase/buckets")
        for (let i = 0; i < allFiles.length; i++) {
          const file = allFiles[i]
          const record = mediaRecords[i]
          if (!record) continue
          const { error: uploadErr } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(record.storageKey, file, { contentType: record.contentType, upsert: false })
          if (uploadErr) {
            throw new Error(`Media upload failed: ${uploadErr.message}`)
          }
        }
      }

      toaster.create({
        title: "Success",
        description: "Activity updated successfully",
        type: "success",
        duration: 5000,
      })
      onComplete?.()
      onClose()
    } catch (err) {
      console.error("Error updating activity:", err)
      const message = err instanceof Error ? err.message : "Failed to update activity"
      setError(message)
      toaster.create({ title: "Error", description: message, type: "error", duration: 5000 })
    } finally {
      setSaving(false)
      setCompressing(false)
    }
  }

  if (!open) return null

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.4)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "white",
          padding: 24,
          borderRadius: 8,
          width: "min(1200px, 90vw)",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ fontWeight: "bold", fontSize: "1.125rem", marginBottom: 16 }}>
          Edit Activity
        </div>

        {/* Public/Private Toggle */}
        <div style={{ marginBottom: 12, padding: 12, background: "#f3f4f6", borderRadius: 8 }}>
          <Flex align="center" gap={3}>
            <Checkbox checked={isPublic} onCheckedChange={(checked) => setIsPublic(!!checked)} />
            <Box flex={1}>
              <Text fontWeight="semibold" fontSize="sm">Make this activity public</Text>
              <Text fontSize="xs" color="gray.600">Public activities appear on the beneficiary&apos;s profile page</Text>
            </Box>
            <Box px={2} py={1} borderRadius={4} fontWeight="semibold" fontSize="xs"
              bg={isPublic ? "green.100" : "gray.200"} color={isPublic ? "green.800" : "gray.600"}>
              {isPublic ? "PUBLIC" : "PRIVATE"}
            </Box>
          </Flex>
        </div>

        <SelectRoot
          collection={activityTypeCollection}
          className="border border-stone-600"
          style={{ marginBottom: 12 }}
          value={[activityType]}
          onValueChange={(details) => {
            const newType = details.value[0]
            if (newType === "INFO" || newType === "UPDATE" || newType === "SUBSCRIPTION") {
              setActivityType(newType)
            }
          }}
        >
          <SelectTrigger className="w-full"><SelectValueText placeholder="Select Activity Type" /></SelectTrigger>
          <SelectContent>
            {activityTypeCollection.items.map((option) => (
              <SelectItem key={option.value} item={option}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>

        <div style={{ marginBottom: 12 }}>
          <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} p={2} className="border border-stone-600" />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <ProofreadButton text={title} onAccept={setTitle} fieldLabel="Title" size="sm" type="activity" />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <Textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} p={2} className="border border-stone-600" />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <ProofreadButton text={description} onAccept={setDescription} fieldLabel="Description" size="sm" type="activity" />
          </div>
        </div>

        {/* Existing Images */}
        {existingImages.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontWeight: 500 }}>Current Images</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {existingImages.map((src, index) => (
                <div key={src} className="relative group" style={{ width: 150, height: 150 }}>
                  <div style={{ width: "100%", height: "100%", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb", backgroundColor: "#f9fafb", position: "relative" }}>
                    <Image src={src} alt={`Existing ${index + 1}`} fill className="object-cover" unoptimized />
                  </div>
                  <button onClick={() => handleRemoveExistingImage(index)} className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600" type="button" aria-label="Remove image">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upload New Images */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 500 }}>Upload New Images</label>
          <FileUploadRoot
            key={imageUploadKey}
            onFileChange={(fileDetails) => {
              if (fileDetails.acceptedFiles.length === 0 && fileDetails.rejectedFiles.length === 0) return
              if (fileDetails.rejectedFiles.length > 0) {
                toaster.create({
                  title: "Too many images",
                  description: "Maximum of 5 images, 2 videos, and 5 PDF files allowed.",
                  type: "error",
                  duration: 5000,
                })
              }
              setImageFiles(fileDetails.acceptedFiles)
              setImageUploadKey((k) => k + 1)
            }}
            accept={["image/*"]}
            maxFiles={5}
          >
            <FileUploadTrigger asChild>
              <Button variant="outline" size="sm" className="border" px={4}><HiUpload /> Upload Images</Button>
            </FileUploadTrigger>
            <FileUploadList showSize clearable files={imageFiles} />
          </FileUploadRoot>
          {imagePreviews.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {imagePreviews.map((src, index) => (
                <div key={src} className="relative group" style={{ width: 150, height: 150 }}>
                  <div style={{ width: "100%", height: "100%", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb", backgroundColor: "#f9fafb", position: "relative" }}>
                    <Image src={src} alt={`Preview ${index + 1}`} fill className="object-cover" unoptimized />
                  </div>
                  <button onClick={() => handleRemoveImage(index)} className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600" type="button" aria-label="Remove image">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Existing Videos */}
        {existingVideos.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontWeight: 500 }}>Current Videos</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {existingVideos.map((src, index) => (
                <div key={src} className="relative group" style={{ width: 240, height: 150 }}>
                  <div style={{ width: "100%", height: "100%", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb", backgroundColor: "#000" }}>
                    <video src={src} controls style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}>Your browser does not support the video tag.</video>
                  </div>
                  <button onClick={() => handleRemoveExistingVideo(index)} className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10" type="button" aria-label="Remove video">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upload New Videos */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 500 }}>Upload New Videos</label>
          <FileUploadRoot
            key={videoUploadKey}
            onFileChange={(fileDetails) => {
              if (fileDetails.acceptedFiles.length === 0 && fileDetails.rejectedFiles.length === 0) return
              if (fileDetails.rejectedFiles.length > 0) {
                toaster.create({
                  title: "Too many videos",
                  description: "Maximum of 5 images, 2 videos, and 5 PDF files allowed.",
                  type: "error",
                  duration: 5000,
                })
              }
              setVideoFiles(fileDetails.acceptedFiles)
              setVideoUploadKey((k) => k + 1)
            }}
            accept={["video/*"]}
            maxFiles={2}
          >
            <FileUploadTrigger asChild>
              <Button variant="outline" size="sm" className="border" px={4}><HiUpload /> Upload Videos</Button>
            </FileUploadTrigger>
            <FileUploadList showSize clearable files={videoFiles} />
          </FileUploadRoot>
          {videoPreviews.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {videoPreviews.map((src, index) => (
                <div key={src} className="relative group" style={{ width: 240, height: 150 }}>
                  <div style={{ width: "100%", height: "100%", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb", backgroundColor: "#000" }}>
                    <video src={src} controls style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}>Your browser does not support the video tag.</video>
                  </div>
                  <button onClick={() => handleRemoveVideo(index)} className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10" type="button" aria-label="Remove video">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <div style={{ color: "red", marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <Button onClick={onClose} style={{ marginRight: 12 }} disabled={saving || compressing}>Cancel</Button>
          <Button colorScheme="blue" onClick={handleSave} disabled={!title || !description || saving || compressing}>
            {compressing ? "Compressing..." : saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DeleteActivityModal
// ─────────────────────────────────────────────────────────────────────────────

interface DeleteModalProps {
  open: boolean
  onClose: () => void
  activity: Activity | null
  onDelete: () => void
  deleting: boolean
  error: string | null
}

export const DeleteActivityModal: React.FC<DeleteModalProps> = ({
  open,
  onClose,
  activity,
  onDelete,
  deleting,
  error,
}) => {
  useEffect(() => {
    if (open) {
      const originalStyle = window.getComputedStyle(document.body).overflow
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = originalStyle
      }
    }
  }, [open])

  if (!open || !activity) return null

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.4)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "white",
          padding: 24,
          borderRadius: 8,
          minWidth: 350,
          maxWidth: "90vw",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ fontWeight: "bold", fontSize: "1.125rem", marginBottom: 16 }}>
          Delete Activity
        </div>
        <div style={{ marginBottom: 16 }}>
          Are you sure you want to delete the activity <b>{activity.title}</b>?
        </div>
        {error && <div style={{ color: "red", marginBottom: 8 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <Button onClick={onClose} style={{ marginRight: 12 }} disabled={deleting}>Cancel</Button>
          <Button colorScheme="red" onClick={onDelete} disabled={deleting}>Delete</Button>
        </div>
      </div>
    </div>
  )
}
