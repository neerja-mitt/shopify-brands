/**
 * Access-token encryption at rest (spec §4.3, settled rule §3).
 *
 * Shopify access tokens are NEVER stored in plaintext. We encrypt with
 * AES-256-GCM (authenticated encryption), using the 32-byte key from
 * TOKEN_ENCRYPTION_KEY (hex-encoded). The stored blob is:
 *
 *   base64( iv[12] ‖ authTag[16] ‖ ciphertext )
 *
 * Decryption is in-memory and momentary — only when making a Shopify call.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // AES-256

/** Decode and validate the hex key. Throws if it isn't exactly 32 bytes. */
function decodeKey(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (hex-encoded); got ${key.length}`,
    );
  }
  return key;
}

/** Encrypt a plaintext token. Returns the base64 blob to persist. */
export function encryptToken(plaintext: string, keyHex: string): string {
  const key = decodeKey(keyHex);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/** Decrypt a base64 blob produced by {@link encryptToken}. Throws on tamper. */
export function decryptToken(blob: string, keyHex: string): string {
  const key = decodeKey(keyHex);
  const data = Buffer.from(blob, 'base64');

  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Encrypted token blob is too short to be valid');
  }

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  // .final() throws if the auth tag doesn't verify — i.e. the blob was tampered.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
