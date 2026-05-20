import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

if (!process.env.SUPABASE_URL)         throw new Error("Missing SUPABASE_URL in .env");
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error("Missing SUPABASE_SERVICE_KEY in .env");

// Service role key — bypasses RLS, full read/write
// Never expose outside this server
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const BIBS_USER_ID = "00000000-0000-0000-0000-000000000001";
