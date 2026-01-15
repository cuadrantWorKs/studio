import { createClient } from '@supabase/supabase-js';
import { Database } from './techtrack/supabase-types';

export const getAdminSupabase = () => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
        console.warn('Supabase Service Key missing - falling back to Anon key (RLS restrictions apply)');
        return createClient<Database>(
            supabaseUrl || '',
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
        );
    }

    return createClient<Database>(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
};
