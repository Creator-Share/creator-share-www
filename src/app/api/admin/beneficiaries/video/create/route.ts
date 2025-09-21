import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  try {
    const formData = await req.formData();
    const beneficiaryId = formData.get('beneficiary_id') as string;
    const videoFile = formData.get('video') as File;
    
    if (!beneficiaryId) {
      return NextResponse.json({ error: "Beneficiary ID is required" }, { status: 400 });
    }
    
    if (!videoFile) {
      return NextResponse.json({ error: "No video provided" }, { status: 400 });
    }

    const fileExt = videoFile.name.split('.').pop();
    const fileName = `${beneficiaryId}-video-${Date.now()}.${fileExt}`;
    const filePath = `beneficiaries/${beneficiaryId}/${fileName}`;
    
    // Upload file to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('beneficiaries')
      .upload(`videos/${filePath}`, videoFile);
      
    if (uploadError) {
      console.error('Video upload error:', uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 400 });
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from('beneficiaries')
      .getPublicUrl(`videos/${filePath}`);

    // Update beneficiary record with video URL
    const { error: updateError } = await supabase
      .from("beneficiaries")
      .update({ video_url: urlData.publicUrl })
      .eq("id", beneficiaryId);

    if (updateError) {
      console.error('Update beneficiary video URL error:', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({ 
      success: true, 
      video_url: urlData.publicUrl 
    }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}