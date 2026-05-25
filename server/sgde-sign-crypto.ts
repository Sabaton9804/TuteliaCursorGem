import crypto from 'node:crypto';

/** Misma clave que el portal Angular SGDE (`encryptData` en main bundle). */
const SGDE_PORTAL_AES_PASSPHRASE = 'Pa$$.2025$';

function evpBytesToKey(
  password: string,
  salt: Buffer,
  keyLen: number,
  ivLen: number
): { key: Buffer; iv: Buffer } {
  const passwd = Buffer.from(password, 'utf8');
  let derived = Buffer.alloc(0);
  let block = Buffer.alloc(0);
  while (derived.length < keyLen + ivLen) {
    const h = crypto.createHash('md5');
    if (block.length) h.update(block);
    h.update(passwd);
    h.update(salt);
    block = h.digest();
    derived = Buffer.concat([derived, block]);
  }
  return {
    key: derived.subarray(0, keyLen),
    iv: derived.subarray(keyLen, keyLen + ivLen),
  };
}

/** Cifrado compatible con `CryptoJS.AES.encrypt(JSON.stringify(pwd), "Pa$$.2025$")` del portal SGDE. */
export function encryptSgdePortalPassword(plainPassword: string): string {
  const salt = crypto.randomBytes(8);
  const { key, iv } = evpBytesToKey(SGDE_PORTAL_AES_PASSPHRASE, salt, 32, 16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const payload = JSON.stringify(plainPassword);
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('Salted__'), salt, encrypted]).toString('base64');
}
