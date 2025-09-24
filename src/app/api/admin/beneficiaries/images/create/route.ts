import { NextResponse } from "next/server";
import { getStorageKey, generatePublicUrl, uploadFile } from "@/utils/supabase/media";
import type { Database } from "@/lib/types/db.types";

type MediaRow = Database["public"]["Tables"]["media"]["Row"];

export async function POST(req: Request) {
  const { createClient } = await import("@/utils/supabase/server");
  const supabase = await createClient();
  try {
    const formData = await req.formData();
    const beneficiaryId = formData.get('beneficiaryId') as string;
    const imageFiles = formData.getAll('images') as File[];

    if (!beneficiaryId) {
      return NextResponse.json({ error: "Missing beneficiaryId" }, { status: 400 });
    }

    if (!imageFiles || imageFiles.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }

    const responses: Array<Record<string, any>> = [];

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const extPart = file.name.split('.').pop() || "";
      const extension = extPart.toLowerCase();

      // Insert media row first
      const { data: inserted, error: insertErr } = await supabase
        .from('media')
        .insert([{ parent_id: beneficiaryId, extension, type: 'IMAGE' }])
        .select()
        .single();

      if (insertErr) {
        console.error("Beneficiary images upload error: DB insert failed:", insertErr);
        // Skip and continue
        continue;
      }

      const mediaRow = inserted as MediaRow;

      // Upload file to storage using helper
      const { error: uploadErr } = await uploadFile(supabase, mediaRow, file, {
        cacheControl: '3600',
        contentType: file.type,
        upsert: false
      });

      if (uploadErr) {
        console.error("Beneficiary images upload error: storage upload failed:", uploadErr);
      }

      const respItem = {
        ...mediaRow,
        public_url: generatePublicUrl(mediaRow),
        upload_error: uploadErr?.message || null
      };

      responses.push(respItem);
    }

    return NextResponse.json(responses, { status: 200 });
  } catch (err: unknown) {
    console.error("Beneficiary images upload error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
