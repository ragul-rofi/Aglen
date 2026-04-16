import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY for farmer app auth.');
}

export const farmerAuth = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export function getCurrentSession() {
  return farmerAuth.auth.getSession().then(({ data }) => data.session);
}

export async function signInWithPassword(email, password) {
  const { error } = await farmerAuth.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function getSessionProfile(userId) {
  const { data, error } = await farmerAuth
    .from('users')
    .select('id, full_name, location_state, role')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return data;
}
