import { createClient } from '@supabase/supabase-js';

// Clean environment injection protocols se keys securely runtime context se load hongi
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("🚨 CRITICAL CORE EXCEPTION: Supabase keys missing inside environment validation boundaries.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);