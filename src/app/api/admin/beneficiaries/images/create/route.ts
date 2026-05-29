import { NextResponse } from "next/server"
import { MediaRow, getDirectMediaUrl, uploadFile } from "@/utils/supabase/media"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

// Route segment config for Vercel deployment
export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(req: Request) {
  const { createClient } = await import("@/utils/supabase/server")
  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response
  try {
    const formData = await req.formData()
    const beneficiaryId = formData.get("beneficiaryId") as string
    const imageFiles = formData.getAll("images") as File[]

    if (!beneficiaryId) {
      return NextResponse.json(
        { error: "Missing beneficiaryId" },
        { status: 400 },
      )
    }

    if (!imageFiles || imageFiles.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 })
    }

    // Validate file sizes (50MB max per file)
    const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
    for (const file of imageFiles) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File ${file.name} is too large. Maximum size is 50MB.` },
          { status: 413 },
        )
      }
    }

    const responses: Array<Record<string, unknown>> = []

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i]
      const extPart = file.name.split(".").pop() || ""
      const extension = extPart.toLowerCase()

      // Insert media row first
      const { data: inserted, error: insertErr } = await supabase
        .from("media")
        .insert([{ parent_id: beneficiaryId, extension, type: "IMAGE" }])
        .select()
        .single()

      if (insertErr) {
        console.error(
          "Beneficiary images upload error: DB insert failed:",
          insertErr,
        )
        // Skip and continue
        continue
      }

      const mediaRow = inserted as unknown as MediaRow

      // Upload file to storage using helper
      const { error: uploadErr } = await uploadFile(supabase, mediaRow, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      })

      if (uploadErr) {
        console.error(
          "Beneficiary images upload error: storage upload failed:",
          uploadErr,
        )
      }

      const uploadErrorMessage =
        uploadErr instanceof Error
          ? uploadErr.message
          : typeof uploadErr === "object" &&
              uploadErr !== null &&
              "message" in uploadErr
            ? String((uploadErr as { message?: unknown }).message)
            : uploadErr != null
              ? String(uploadErr)
              : null

      const respItem = {
        ...mediaRow,
        public_url: getDirectMediaUrl(mediaRow),
        upload_error: uploadErrorMessage,
      }

      responses.push(respItem)
    }

    return NextResponse.json(responses, { status: 200 })
  } catch (err: unknown) {
    console.error("Beneficiary images upload error:", err)
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
