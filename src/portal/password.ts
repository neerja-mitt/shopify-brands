/**
 * Password hashing for merchant accounts (Phase 3.1).
 *
 * scrypt (built into Node — no dependency) with a per-password random salt.
 * Stored format: `saltHex:hashHex`. Verification is constant-time.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/** Hash a plaintext password for storage. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** Verify a plaintext password against a stored `saltHex:hashHex` value. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const derived = (await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length)) as Buffer;

  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
