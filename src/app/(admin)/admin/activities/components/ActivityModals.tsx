import React, { useEffect, useState } from "react"
import { Button, Input, Textarea, createListCollection } from "@chakra-ui/react"
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
import { HiUpload } from "react-icons/hi"

const activityTypeCollection = createListCollection({
  items: [
    { value: "INFO", label: "INFO" },
    { value: "UPDATE", label: "UPDATE" },
    { value: "SUBSCRIPTION", label: "SUBSCRIPTION" },
  ],
})

interface CreateModalProps {
  open: boolean
  onClose: () => void
  title: string
  description: string
  activityType: string
  beneficiaryId: string
  onTitleChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onActivityTypeChange: (v: string) => void
  onCreate: (formData: FormData) => void
  creating: boolean
  error: string | null
}

export const CreateActivityModal: React.FC<CreateModalProps> = ({
  open,
  onClose,
  title,
  description,
  activityType,
  beneficiaryId,
  onTitleChange,
  onDescriptionChange,
  onActivityTypeChange,
  onCreate,
  creating,
  error,
}) => {
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [videoFiles, setVideoFiles] = useState<File[]>([])

  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [videoPreviews, setVideoPreviews] = useState<string[]>([])

  useEffect(() => {
    if (!open) {
      setImageFiles([])
      setVideoFiles([])
      setImagePreviews([])
      setVideoPreviews([])
      return
    }
  }, [open])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (open) {
      const originalStyle = window.getComputedStyle(document.body).overflow
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = originalStyle
      }
    }
  }, [open])

  useEffect(() => {
    const urls = imageFiles.map((file) => URL.createObjectURL(file))
    setImagePreviews(urls)

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [imageFiles])

  useEffect(() => {
    const urls = videoFiles.map((file) => URL.createObjectURL(file))
    setVideoPreviews(urls)

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [videoFiles])

  const handleRemoveImage = (index: number) => {
    // Revoke the object URL for the removed image
    if (imagePreviews[index]) {
      URL.revokeObjectURL(imagePreviews[index])
    }
    // Remove from both arrays
    const newFiles = imageFiles.filter((_, i) => i !== index)
    const newPreviews = imagePreviews.filter((_, i) => i !== index)
    setImageFiles(newFiles)
    setImagePreviews(newPreviews)
  }

  const handleRemoveVideo = (index: number) => {
    // Revoke the object URL for the removed video
    if (videoPreviews[index]) {
      URL.revokeObjectURL(videoPreviews[index])
    }
    // Remove from both arrays
    const newFiles = videoFiles.filter((_, i) => i !== index)
    const newPreviews = videoPreviews.filter((_, i) => i !== index)
    setVideoFiles(newFiles)
    setVideoPreviews(newPreviews)
  }

  const handleCreate = () => {
    const formData = new FormData()
    formData.append("title", title)
    formData.append("description", description)
    formData.append("activity_type", activityType)
    formData.append("activity_source", "admin") // Admin manually creates activity
    formData.append("beneficiary_id", beneficiaryId)
    imageFiles.forEach((file) => formData.append("images", file))
    videoFiles.forEach((file) => formData.append("videos", file))
    onCreate(formData)
  }

  return open ? (
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
        <div
          style={{ fontWeight: "bold", fontSize: "1.125rem", marginBottom: 16 }}
        >
          Create Activity
        </div>
        <SelectRoot
          collection={activityTypeCollection}
          className="border border-stone-600"
          style={{ marginBottom: 12 }}
          value={[activityType]}
          onValueChange={(details) => onActivityTypeChange(details.value[0])}
        >
          <SelectTrigger className="w-full">
            <SelectValueText placeholder="Select Activity Type" />
          </SelectTrigger>
          <SelectContent>
            {activityTypeCollection.items.map((option) => (
              <SelectItem key={option.value} item={option}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
        <div style={{ marginBottom: 12 }}>
          <Input
            placeholder="Title"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            p={2}
            className="border border-stone-600"
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <ProofreadButton
              text={title}
              onAccept={onTitleChange}
              fieldLabel="Title"
              size="sm"
            />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <Textarea
            placeholder="Description"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            p={2}
            className="border border-stone-600"
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <ProofreadButton
              text={description}
              onAccept={onDescriptionChange}
              fieldLabel="Description"
              size="sm"
            />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 500 }}>Upload Images</label>
          <FileUploadRoot
            key={`images-${imageFiles.map(f => `${f.name}-${f.size}`).join('|')}`}
            onFileChange={(fileDetails) => {
              const newFiles = fileDetails.acceptedFiles
              
              // Clean up old preview URLs that are no longer in the list
              imagePreviews.forEach((url, index) => {
                if (!newFiles[index] || newFiles[index] !== imageFiles[index]) {
                  URL.revokeObjectURL(url)
                }
              })
              
              // Create new preview URLs for new files
              const newUrls = newFiles.map((file, index) => {
                // Reuse existing URL if file hasn't changed
                if (imageFiles[index] === file && imagePreviews[index]) {
                  return imagePreviews[index]
                }
                return URL.createObjectURL(file)
              })
              
              setImageFiles(newFiles)
              setImagePreviews(newUrls)
            }}
            accept={["image/*"]}
            maxFiles={5}
          >
            <FileUploadTrigger asChild>
              <Button variant="outline" size="sm" className="border" px={4}>
                <HiUpload /> Upload Images
              </Button>
            </FileUploadTrigger>
            <FileUploadList showSize clearable files={imageFiles} />
          </FileUploadRoot>
          {imagePreviews.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 8,
              }}
            >
              {imagePreviews.map((src, index) => (
                <div
                  key={src}
                  className="relative group"
                  style={{
                    width: 150,
                    height: 150,
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: 8,
                      overflow: "hidden",
                      border: "1px solid #e5e7eb",
                      backgroundColor: "#f9fafb",
                      position: "relative",
                    }}
                  >
                    <Image
                      src={src}
                      alt={`Preview ${index + 1}`}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <button
                    onClick={() => handleRemoveImage(index)}
                    className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    type="button"
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
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 500 }}>Upload Videos</label>
          <FileUploadRoot
            key={`videos-${videoFiles.map(f => `${f.name}-${f.size}`).join('|')}`}
            onFileChange={(fileDetails) => {
              const newFiles = fileDetails.acceptedFiles
              
              // Clean up old preview URLs that are no longer in the list
              videoPreviews.forEach((url, index) => {
                if (!newFiles[index] || newFiles[index] !== videoFiles[index]) {
                  URL.revokeObjectURL(url)
                }
              })
              
              // Create new preview URLs for new files
              const newUrls = newFiles.map((file, index) => {
                // Reuse existing URL if file hasn't changed
                if (videoFiles[index] === file && videoPreviews[index]) {
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
              <Button variant="outline" size="sm" className="border" px={4}>
                <HiUpload /> Upload Videos
              </Button>
            </FileUploadTrigger>
            <FileUploadList showSize clearable files={videoFiles} />
          </FileUploadRoot>
          {videoPreviews.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 8,
              }}
            >
              {videoPreviews.map((src, index) => (
                <div
                  key={src}
                  className="relative group"
                  style={{
                    width: 240,
                    height: 150,
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: 8,
                      overflow: "hidden",
                      border: "1px solid #e5e7eb",
                      backgroundColor: "#000",
                    }}
                  >
                    <video
                      src={src}
                      controls
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                    >
                      Your browser does not support the video tag.
                    </video>
                  </div>
                  <button
                    onClick={() => handleRemoveVideo(index)}
                    className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10"
                    type="button"
                    aria-label="Remove video"
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
                </div>
              ))}
            </div>
          )}
        </div>
        {error && <div style={{ color: "red", marginBottom: 8 }}>{error}</div>}
        <div
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}
        >
          <Button
            onClick={onClose}
            style={{ marginRight: 12 }}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button
            colorScheme="blue"
            onClick={handleCreate}
            disabled={!title || !description || creating}
          >
            {creating ? "Creating..." : "Create"}
          </Button>
        </div>
      </div>
    </div>
  ) : null
}

interface EditModalProps {
  open: boolean
  onClose: () => void
  title: string
  description: string
  onTitleChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onSave: () => void
  saving: boolean
  error: string | null
}

export const EditActivityModal: React.FC<EditModalProps> = ({
  open,
  onClose,
  title,
  description,
  onTitleChange,
  onDescriptionChange,
  onSave,
  saving,
  error,
}) => {
  // Prevent body scroll when modal is open
  useEffect(() => {
    if (open) {
      const originalStyle = window.getComputedStyle(document.body).overflow
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = originalStyle
      }
    }
  }, [open])

  return open ? (
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
        <div
          style={{ fontWeight: "bold", fontSize: "1.125rem", marginBottom: 16 }}
        >
          Edit Activity
        </div>
        <div style={{ marginBottom: 12 }}>
          <Input
            placeholder="Title"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            p={2}
            className="border border-stone-600"
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <ProofreadButton
              text={title}
              onAccept={onTitleChange}
              fieldLabel="Title"
              size="sm"
            />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <Textarea
            placeholder="Description"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            p={2}
            className="border border-stone-600"
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <ProofreadButton
              text={description}
              onAccept={onDescriptionChange}
              fieldLabel="Description"
              size="sm"
            />
          </div>
        </div>
        {error && <div style={{ color: "red", marginBottom: 8 }}>{error}</div>}
        <div
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}
        >
          <Button
            onClick={onClose}
            style={{ marginRight: 12 }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            colorScheme="blue"
            onClick={onSave}
            disabled={!title || !description}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  ) : null
}

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
  // Prevent body scroll when modal is open
  useEffect(() => {
    if (open) {
      const originalStyle = window.getComputedStyle(document.body).overflow
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = originalStyle
      }
    }
  }, [open])

  return open && activity ? (
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
        <div
          style={{ fontWeight: "bold", fontSize: "1.125rem", marginBottom: 16 }}
        >
          Delete Activity
        </div>
        <div style={{ marginBottom: 16 }}>
          Are you sure you want to delete the activity <b>{activity.title}</b>?
        </div>
        {error && <div style={{ color: "red", marginBottom: 8 }}>{error}</div>}
        <div
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}
        >
          <Button
            onClick={onClose}
            style={{ marginRight: 12 }}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button colorScheme="red" onClick={onDelete} disabled={deleting}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  ) : null
}
