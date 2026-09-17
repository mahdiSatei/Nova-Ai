import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encrypt/decrypt for the central provider API key.
 *
 * Each save produces a JSON object `{ ciphertext, iv, authTag }` stored
 * as a single text column. The encryption key comes from the runtime env
 * (`PROVIDER_ENCRYPTION_KEY`, base64-encoded 32 bytes) and is never
 * persisted.
 */

interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

let cachedKey: Buffer | null = null;

/**
 * Lazily load the 32-byte encryption key from the env var.
 */
function getKey(): Buffer {
  if (!cachedKey) {
    const raw = process.env.PROVIDER_ENCRYPTION_KEY;
    if (!raw) throw new Error('PROVIDER_ENCRYPTION_KEY is not set');
    cachedKey = Buffer.from(raw, 'base64');
    if (cachedKey.length !== 32) {
      throw new Error(`PROVIDER_ENCRYPTION_KEY must be 32 bytes (got ${cachedKey.length})`);
    }
  }
  return cachedKey;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
  return JSON.stringify(payload);
}

export function decrypt(json: string): string {
  const key = getKey();
  let payload: EncryptedPayload;
  try {
    payload = JSON.parse(json) as EncryptedPayload;
  } catch {
    throw new Error('Corrupt encrypted credential');
  }

  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.authTag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Corrupt encrypted credential');
  }
}
