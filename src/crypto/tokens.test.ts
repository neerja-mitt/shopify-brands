import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

import { decryptToken, encryptToken } from './tokens.js';

const KEY = randomBytes(32).toString('hex');

test('round-trips a token', () => {
  // Deliberately NOT shaped like a real Shopify token (`shpat_…`) so secret
  // scanners don't flag this fixture.
  const token = 'fake-access-token-value-for-tests';
  const blob = encryptToken(token, KEY);
  assert.notEqual(blob, token); // ciphertext, not plaintext
  assert.equal(decryptToken(blob, KEY), token);
});

test('produces different ciphertext each time (random IV)', () => {
  const token = 'same-token-value';
  assert.notEqual(encryptToken(token, KEY), encryptToken(token, KEY));
});

test('rejects a key of the wrong length', () => {
  assert.throws(() => encryptToken('x', 'abcd'), /must be 32 bytes/);
});

test('fails to decrypt with a different key', () => {
  const blob = encryptToken('secret', KEY);
  const otherKey = randomBytes(32).toString('hex');
  assert.throws(() => decryptToken(blob, otherKey));
});

test('fails to decrypt a tampered blob (auth tag mismatch)', () => {
  const blob = encryptToken('secret', KEY);
  const bytes = Buffer.from(blob, 'base64');
  const last = bytes.length - 1;
  bytes[last] = (bytes[last] ?? 0) ^ 0xff; // flip a ciphertext bit
  assert.throws(() => decryptToken(bytes.toString('base64'), KEY));
});

test('rejects a blob too short to contain iv + tag', () => {
  assert.throws(() => decryptToken(Buffer.from('short').toString('base64'), KEY), /too short/);
});
