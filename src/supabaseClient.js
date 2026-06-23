import { createClient } from '@supabase/supabase-js';

// Supabase Dashboard -> Settings (⚙️) -> API se dono keys laakar yahan paste karo
const supabaseUrl = 'https://zjcwarmrvwmjswhaajgx.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqY3dhcm1ydndtanN3aGFhamd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NzA0MTAsImV4cCI6MjA5NzM0NjQxMH0.NOZpsO3pznS5714uBvLNOzi9SW3PCPpszkn3HAdkLFA';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);