import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function deriveKey(): Buffer {
  const raw = (
    process.env.SGDE_CREDENTIALS_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ''
  ).trim();
  if (!raw) {
    throw new Error(
      'Falta SGDE_CREDENTIALS_KEY en el servidor (clave para cifrar contraseñas SGDE por usuario).'
    );
  }
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return scryptSync(raw, 'tutelia-sgde-credentials-v1', 32);
}

export function sgdeEncryptionAvailable(): boolean {
  return Boolean(
    process.env.SGDE_CREDENTIALS_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
}

export function encryptSgdePassword(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSgdePassword(ciphertext: string): string {
  const parts = String(ciphertext || '').split(':');
  if (parts[0] !== 'v1' || parts.length !== 4) {
    throw new Error('Formato de credencial SGDE inválido.');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const data = Buffer.from(parts[3], 'base64');
  const key = deriveKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function maskSgdeUsername(username: string): string {
  const u = username.trim();
  if (u.length <= 3) return '***';
  if (u.includes('@')) {
    const [local, domain] = u.split('@');
    const head = local.slice(0, 2);
    return `${head}***@${domain}`;
  }
  return `${u.slice(0, 3)}***`;
}
