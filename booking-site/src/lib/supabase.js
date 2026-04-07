import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment')
}

// Public anon client — no session token, no auth headers
// All mutations go through SECURITY DEFINER RPCs
export const supabase = createClient(url, anonKey)
