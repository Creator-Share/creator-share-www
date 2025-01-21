import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/utils/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json(
        { error: "Email is required for verification" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("auth.users")
      .select("*")
      .eq("email", email)
      .single();

    if (error || !data) {
      console.error("User not found:", error?.message || "No user data");
      return NextResponse.json(
        { error: "User not found or verification failed" },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: "User verified successfully", user: data });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}