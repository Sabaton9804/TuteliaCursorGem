import { createClient, SupabaseClient } from '@supabase/supabase-js';

/** URL del proyecto (https://xxx.supabase.co), sin /rest/v1 al final. */
export function normalizeSupabaseProjectUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim().replace(/\/+$/, '');
  if (s.endsWith('/rest/v1')) s = s.slice(0, -'/rest/v1'.length).replace(/\/+$/, '');
  return s || undefined;
}

const url = normalizeSupabaseProjectUrl(
  (import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL) as string | undefined
);
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) as
  | string
  | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(url?.trim() && anonKey?.trim());
}

/** Cliente único para navegador (Auth + PostgREST + Realtime). */
export const supabase: SupabaseClient = createClient(url || 'https://invalid.local', anonKey || 'invalid', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export function assertSupabaseConfigured(): void {
  if (!isSupabaseConfigured()) {
    throw new Error(
      'Faltan URL y clave anónima de Supabase (VITE_* o NEXT_PUBLIC_SUPABASE_* en .env). Reinicie Vite.'
    );
  }
}
