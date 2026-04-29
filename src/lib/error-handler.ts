import { supabase } from './supabase';

export interface DataPermissionErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId: string | null;
    email: string | null;
  };
}

export async function handleDataPermissionError(
  error: any,
  operationType: DataPermissionErrorInfo['operationType'],
  path: string | null = null
) {
  const code = String(error?.code ?? '');
  const msg = String(error?.message ?? '');
  const isRls =
    code === '42501' ||
    msg.toLowerCase().includes('permission denied') ||
    msg.toLowerCase().includes('row-level security') ||
    msg.toLowerCase().includes('rls');

  if (isRls) {
    const { data } = await supabase.auth.getUser();
    const u = data.user;
    const info: DataPermissionErrorInfo = {
      error: msg,
      operationType,
      path,
      authInfo: {
        userId: u?.id ?? null,
        email: u?.email ?? null,
      },
    };
    console.error('Supabase / RLS:', info);
    throw new Error(JSON.stringify(info));
  }
  throw error;
}
