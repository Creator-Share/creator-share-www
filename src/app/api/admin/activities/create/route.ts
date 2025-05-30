import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const title = formData.get("title") as string | null;
  const description = formData.get("description") as string | null;
  const beneficiary_id = formData.get("beneficiary_id") as string | null;

  if (!description || !beneficiary_id) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  const images: File[] = [];
  const videos: File[] = [];
  for (const [key, value] of formData.entries()) {
    if (value instanceof File && value.size > 0) {
      if (key === "images") images.push(value);
      if (key === "videos") videos.push(value);
    }
  }

  const supabase = await createClient();
  const images_url: string[] = [];
  for (const file of images) {
    const ext = file.name.split('.').pop();
    const filePath = `activities/images/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage
      .from("activities-media")
      .upload(filePath, file, { contentType: file.type });
    if (error) {
      console.error("Image upload error:", error.message);
      continue;
    }
    const { data: publicUrlData } = supabase.storage.from("activities-media").getPublicUrl(filePath);
    if (publicUrlData?.publicUrl) images_url.push(publicUrlData.publicUrl);
  }
  const videos_url: string[] = [];
  for (const file of videos) {
    const ext = file.name.split('.').pop();
    const filePath = `activities/videos/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage
      .from("activities-media")
      .upload(filePath, file, { contentType: file.type });
    if (error) {
      console.error("Video upload error:", error.message);
      continue;
    }
    const { data: publicUrlData } = supabase.storage.from("activities-media").getPublicUrl(filePath);
    if (publicUrlData?.publicUrl) videos_url.push(publicUrlData.publicUrl);
  }
  const { data: inserted, error } = await supabase
    .from("activities")
    .insert([
      {
        title,
        description,
        beneficiary_id,
        created_at: new Date().toISOString(),
        images_url,
        videos_url,
      },
    ])
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    const { data: subscribers, error: subError } = await supabase
      .from("beneficiary_subscriptions")
      .select("email")
      .eq("beneficiary_id", beneficiary_id);

    if (!subError && Array.isArray(subscribers)) {
      const { data: beneficiaryData } = await supabase
        .from("beneficiaries")
        .select("name")
        .eq("id", beneficiary_id)
        .single();

      const { sendActivityNotificationEmail } = await import("@/utils/email");
      if (beneficiaryData && beneficiaryData.name) {
        for (const sub of subscribers) {
          try {
            const emailResult = await sendActivityNotificationEmail(
              sub.email,
              beneficiaryData,
              inserted
            );
            await supabase.from("email_logs").insert({
              email: sub.email,
              subject: `New update on ${beneficiaryData.name}`,
              status: emailResult.success ? "sent" : "failed",
              error: emailResult.error ? JSON.stringify(emailResult.error) : null,
              message_id: emailResult.messageId,
              created_at: new Date(),
            });
          } catch (emailErr) {
            console.error("Error sending activity notification email:", emailErr);
            await supabase.from("email_logs").insert({
              email: sub.email,
              subject: `New update on ${beneficiaryData.name}`,
              status: "failed",
              error: emailErr instanceof Error ? emailErr.message : String(emailErr),
              created_at: new Date(),
            });
          }
        }
      }
    }
  } catch (notifyError) {
    console.error("Error notifying subscribers:", notifyError);
  }

  return NextResponse.json({ activity: inserted }, { status: 201 });
}
