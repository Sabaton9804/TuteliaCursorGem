import { supabase } from './supabase';

export async function platformAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sesión requerida');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function platformFetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await platformAuthHeaders();
  const res = await fetch(path, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(String((json as { error?: string }).error || res.statusText || 'Error de plataforma'));
  }
  return json as T;
}
