import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigSchema } from '../dist/config.js';

test('optional provider URLs accept empty strings', () => {
  const result = ConfigSchema.safeParse({
    PLANNER_BASE_URL: '',
    REVIEWER_BASE_URL: '',
    TRIAGE_BASE_URL: '',
  });

  assert.equal(result.success, true);
});

test('optional provider URLs reject malformed non-empty values', () => {
  for (const field of ['PLANNER_BASE_URL', 'REVIEWER_BASE_URL', 'TRIAGE_BASE_URL']) {
    const result = ConfigSchema.safeParse({ [field]: 'not-a-url' });
    assert.equal(result.success, false, `${field} should reject malformed URLs`);
  }
});
