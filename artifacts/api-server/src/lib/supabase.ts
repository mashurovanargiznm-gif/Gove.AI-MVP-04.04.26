import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env["SUPABASE_URL"];
const supabaseKey = process.env["SUPABASE_KEY"];

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_KEY must be set");
}

export const supabase = createClient(supabaseUrl, supabaseKey);

export interface Transaction {
  id: string;
  created_at: string;
  debtor_bin: string;
  amount_kzt: number;
  description: string;
  knp_code: string;
  oked_code: string;
  receiver_iin: string;
  ai_decision: string;
  withheld_percent: number;
  ai_reason: string;
  solana_signature: string | null;
  status: "pending" | "approved" | "blocked";
}
