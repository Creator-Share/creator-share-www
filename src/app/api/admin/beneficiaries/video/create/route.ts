import { NextResponse } from "next/server";
import {  generatePublicUrl, uploadFile } from "@/utils/supabase/media";
import type { Database } from "@/lib/types/db.types";

type MediaRow = Database["public"]["Tables"]["media"]["Row"];

export async function POST(req: Request) {
  const { createClient } = await import("@/utils/supabase/server");
  const supabase = await createClient();

  try {
    const formData = await req.formData();
    const beneficiaryId = (formData.get('beneficiaryId') ?? formData.get('beneficiary_id')) as string;
    // Accept either 'video' or legacy 'videoFile'
    const videoFile = (formData.get('video') ?? formData.get('videoFile')) as File | null;

    if (!beneficiaryId) {
      return NextResponse.json({ error: "Missing beneficiaryId" }, { status: 400 });
    }

    if (!videoFile) {
      return NextResponse.json({ error: "No video provided" }, { status: 400 });
    }

    const extPart = videoFile.name.split('.').pop() || "";
    const extension = extPart.toLowerCase();

    // Insert media row first
    const { data: inserted, error: insertErr } = await supabase
      .from('media')
      .insert([{ parent_id: beneficiaryId, extension, type: 'VIDEO' }])
      .select()
      .single();

    if (insertErr) {
      console.error("Beneficiary video upload error: DB insert failed:", insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 400 });
    }

    const mediaRow = inserted as MediaRow;

    // Upload using helper
    const { error: uploadErr } = await uploadFile(supabase, mediaRow, videoFile, {
      contentType: videoFile.type,
      cacheControl: '3600',
      upsert: false
    });

    if (uploadErr) {
      console.error("Beneficiary video upload error: storage upload failed:", uploadErr);
      // Continue to generate URL and attempt DB update, but include note
    }

    const publicUrl = generatePublicUrl(mediaRow);

    // Persist media reference in beneficiary.metadata.video_media_id (avoid storing full public URL in DB)
    try {
      const { data: existingBeneficiary } = await supabase
        .from("beneficiaries")
        .select("metadata")
        .eq("id", beneficiaryId)
        .single();

      const existingMetadata = (existingBeneficiary && existingBeneficiary.metadata) || {};
      const updatedMetadata = { ...existingMetadata, video_media_id: mediaRow.id };

      const { error: updateError } = await supabase
        .from("beneficiaries")
        .update({ metadata: updatedMetadata })
        .eq("id", beneficiaryId);

      if (updateError) {
        console.error("Beneficiary video upload error: failed to persist media reference:", updateError);
        // Do not fail the whole request — return media info so caller can handle UI updates
      }
    } catch (e) {
      console.error("Unexpected error updating beneficiary metadata with media id:", e);
      // swallow — continue to return media info
    }

    // Return created media row and public URL for immediate client use; DB stores only the media reference.
    return NextResponse.json({ media: mediaRow, public_url: publicUrl }, { status: 200 });
  } catch (err: unknown) {
    console.error("Beneficiary video upload error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}