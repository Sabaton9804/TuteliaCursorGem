import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptSgdePassword, encryptSgdePassword, maskSgdeUsername } from './sgde-crypto';

export type StoredSgdeCredentials = {
  username: string;
  password: string;
};

export async function getUserSgdeCredentials(
  admin: SupabaseClient,
  userId: string
): Promise<StoredSgdeCredentials | null> {
  const { data, error } = await admin
    .from('sgde_credentials')
    .select('username, password_ciphertext')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data?.username || !data?.password_ciphertext) return null;
  try {
    return {
      username: String(data.username).trim(),
      password: decryptSgdePassword(String(data.password_ciphertext)),
    };
  } catch (e) {
    console.error('sgde_credentials decrypt:', e);
    return null;
  }
}

export async function saveUserSgdeCredentials(
  admin: SupabaseClient,
  userId: string,
  username: string,
  password: string
): Promise<{ error: string | null }> {
  const user = username.trim();
  const pass = password;
  if (!user || !pass) {
    return { error: 'Usuario y contraseña SGDE son obligatorios.' };
  }
  let ciphertext: string;
  try {
    ciphertext = encryptSgdePassword(pass);
  } catch (e) {
    return { error: String((e as Error)?.message || e) };
  }
  const { error } = await admin.from('sgde_credentials').upsert(
    {
      user_id: userId,
      username: user,
      password_ciphertext: ciphertext,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
  if (error) return { error: error.message };
  return { error: null };
}

export async function deleteUserSgdeCredentials(
  admin: SupabaseClient,
  userId: string
): Promise<void> {
  await admin.from('sgde_credentials').delete().eq('user_id', userId);
}

export async function getUserSgdeCredentialsMeta(
  admin: SupabaseClient,
  userId: string
): Promise<{ configured: boolean; usernameMasked: string | null; updatedAt: string | null }> {
  const { data } = await admin
    .from('sgde_credentials')
    .select('username, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data?.username) {
    return { configured: false, usernameMasked: null, updatedAt: null };
  }
  return {
    configured: true,
    usernameMasked: maskSgdeUsername(String(data.username)),
    updatedAt: data.updated_at != null ? String(data.updated_at) : null,
  };
}
