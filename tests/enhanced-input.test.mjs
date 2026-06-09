import assert from 'node:assert/strict';
import test from 'node:test';

import { getInputViewport } from '../dist/tui/components/enhanced-text-input.js';

test('input viewport follows the cursor without exceeding one row', () => {
  assert.deepEqual(getInputViewport(40, 40, 12), { start: 29, end: 40 });
  assert.deepEqual(getInputViewport(40, 20, 12), { start: 10, end: 21 });
  assert.deepEqual(getInputViewport(5, 5, 12), { start: 0, end: 11 });
});

test('input viewport is unbounded when no maximum width is supplied', () => {
  assert.deepEqual(getInputViewport(40, 20), { start: 0, end: 40 });
});
