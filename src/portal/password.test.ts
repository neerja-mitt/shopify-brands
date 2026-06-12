import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hashPassword, verifyPassword } from './password.js';

test('verifies the correct password', async () => {
  const hash = await hashPassword('s3cret-passw0rd');
  assert.equal(await verifyPassword('s3cret-passw0rd', hash), true);
});

test('rejects the wrong password', async () => {
  const hash = await hashPassword('s3cret-passw0rd');
  assert.equal(await verifyPassword('wrong', hash), false);
});

test('produces a different hash each time (random salt)', async () => {
  assert.notEqual(await hashPassword('same'), await hashPassword('same'));
});

test('rejects a malformed stored value', async () => {
  assert.equal(await verifyPassword('x', 'not-a-valid-hash'), false);
});
