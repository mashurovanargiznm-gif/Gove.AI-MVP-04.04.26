-- Run this in your Supabase SQL Editor to set up the transactions table
-- Go to: Supabase Dashboard → SQL Editor → Run this script

-- Create the transactions table
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  debtor_bin TEXT NOT NULL,
  amount_kzt NUMERIC NOT NULL,
  description TEXT NOT NULL,
  knp_code TEXT NOT NULL,
  oked_code TEXT NOT NULL,
  receiver_iin TEXT NOT NULL,
  ai_decision TEXT NOT NULL,
  withheld_percent INTEGER NOT NULL DEFAULT 0,
  ai_reason TEXT NOT NULL,
  solana_signature TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'blocked'))
);

-- Enable RLS
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Allow anonymous users to read transactions
CREATE POLICY "Allow anon read" ON public.transactions
  FOR SELECT USING (true);

-- Allow anonymous users to insert transactions
CREATE POLICY "Allow anon insert" ON public.transactions
  FOR INSERT WITH CHECK (true);

-- Allow anonymous users to update transactions
CREATE POLICY "Allow anon update" ON public.transactions
  FOR UPDATE USING (true);

-- Grant usage on the schema and table
GRANT USAGE ON SCHEMA public TO anon;
GRANT ALL ON public.transactions TO anon;
GRANT ALL ON public.transactions TO authenticated;
