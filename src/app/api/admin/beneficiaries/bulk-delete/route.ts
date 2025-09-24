import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { deleteFile } from "@/utils/supabase/media";

export async function POST(req: Request) {
  const supabase = await createClient();
  try {
    const { ids } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "No IDs provided" }, { status: 400 });
    }

    // First, delete related activities
    const { error: activitiesError } = await supabase
      .from("activities")
      .delete()
      .in("beneficiary_id", ids);

    if (activitiesError) {
      return NextResponse.json({ error: activitiesError.message }, { status: 400 });
    }

    // Fetch media rows for these beneficiaries and delete files from storage
    try {
      const { data: mediaRows, error: mediaFetchError } = await supabase
        .from("media")
        .select("id, parent_id, type, extension")
        .in("parent_id", ids);

      if (mediaFetchError) {
        console.error("Failed to fetch media rows for bulk delete:", mediaFetchError);
      } else if (Array.isArray(mediaRows) && mediaRows.length > 0) {
        for (const mr of mediaRows) {
          try {
            const { error: storageErr } = await deleteFile(supabase, mr as any);
            if (storageErr) {
              console.error("Storage delete error for media id", mr.id, storageErr);
            }
          } catch (e) {
            console.error("Unexpected error deleting storage for media id", mr.id, e);
          }
        }

        // Remove media rows from DB
        const { error: mediaDeleteErr } = await supabase
          .from("media")
          .delete()
          .in("parent_id", ids);

        if (mediaDeleteErr) {
          console.error("Failed to delete media rows after storage removal:", mediaDeleteErr);
        }
      }
    } catch (e) {
      console.error("Error during media cleanup for bulk delete:", e);
    }

    // Then, delete beneficiaries
    const { error } = await supabase
      .from("beneficiaries")
      .delete()
      .in("id", ids);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
