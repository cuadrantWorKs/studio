// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

// Asegúrate de que estas variables de entorno estén configuradas en tu entorno de desarrollo y despliegue
// Por ejemplo, en un archivo .env.local
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase URL or Anon Key environment variables.');
  // Depending on your setup, you might want to throw an error or handle this differently.
  throw new Error('Supabase URL and Anon Key environment variables are required.');
  // For development simplicity, we'll just log an error, but a production app
  // should handle this more robustly.
}

export const db = createClient(supabaseUrl!, supabaseAnonKey!);