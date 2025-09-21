import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  try {
    const formData = await req.formData();
    const beneficiaryId = formData.get('beneficiary_id') as string;
    const imageFiles = formData.getAll('images') as File[];
    
    if (!beneficiaryId) {
      return NextResponse.json({ error: "Beneficiary ID is required" }, { status: 400 });
    }
    
    if (!imageFiles || imageFiles.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }

    const uploadedImages = [];
    
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const fileExt = file.name.split('.').pop();
      const fileName = `${beneficiaryId}-${Date.now()}-${i}.${fileExt}`;
      const filePath = `beneficiaries/${beneficiaryId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('beneficiaries')
        .upload(`images/${filePath}`, file);
        
      if (uploadError) {
        console.error('Upload error:', uploadError);
        continue;
      }
      
      // Get public URL
      const { data: urlData } = supabase.storage
        .from('beneficiaries')
        .getPublicUrl(`images/${filePath}`);
        
      uploadedImages.push({
        beneficiary_id: beneficiaryId,
        image_url: urlData.publicUrl,
        order_index: i,
      });
    }
    
    if (uploadedImages.length === 0) {
      return NextResponse.json({ error: "Failed to upload any images" }, { status: 400 });
    }

    // Insert image records into database
    const { error } = await supabase
      .from("media")
      .insert(uploadedImages);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, uploaded: uploadedImages.length }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
