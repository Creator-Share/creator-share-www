import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_SERVICE_ROLE_KEY || "";

export const supabaseAdmin = createClient(SUPABASE_URL, supabaseKey);