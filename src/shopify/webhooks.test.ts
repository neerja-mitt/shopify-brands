import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import { verifyHmac } from './webhooks.ts';

const SECRET = 'test_app_secret';

function sign(body: Buffer, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

test('accepts a correctly signed payload', () => {
  const body = Buffer.from(JSON.stringify({ id: 123, topic: 'products/update' }));
  assert.equal(verifyHmac(body, sign(body), SECRET), true);
});

test('rejects a payload signed with the wrong secret', () => {
  const body = Buffer.from('{"id":1}');
  assert.equal(verifyHmac(body, sign(body, 'wrong_secret'), SECRET), false);
});

test('rejects a tampered body', () => {
  const body = Buffer.from('{"id":1}');
  const hmac = sign(body);
  const tampered = Buffer.from('{"id":2}');
  assert.equal(verifyHmac(tampered, hmac, SECRET), false);
});

test('rejects an empty / missing header', () => {
  const body = Buffer.from('{}');
  assert.equal(verifyHmac(body, '', SECRET), false);
});

test('rejects when no secret is configured', () => {
  const body = Buffer.from('{}');
  assert.equal(verifyHmac(body, sign(body), ''), false);
});
