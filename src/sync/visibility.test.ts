import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveVisibility } from './visibility.js';

test('active with sellable stock is buyable', () => {
  assert.equal(resolveVisibility('active', 3), 'buyable');
});

test('active with no sellable stock shows sold out (still listed)', () => {
  assert.equal(resolveVisibility('active', 0), 'sold_out');
});

test('draft is hidden regardless of stock', () => {
  assert.equal(resolveVisibility('draft', 100), 'hidden');
});

test('archived is hidden regardless of stock', () => {
  assert.equal(resolveVisibility('archived', 100), 'hidden');
});

test('deleted is hidden regardless of stock', () => {
  assert.equal(resolveVisibility('deleted', 100), 'hidden');
});

test('negative sellable qty is treated as sold out, not buyable', () => {
  assert.equal(resolveVisibility('active', -5), 'sold_out');
});
