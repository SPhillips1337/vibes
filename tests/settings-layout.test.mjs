import assert from 'node:assert/strict';
import test from 'node:test';

import { getSettingsViewportSize } from '../dist/tui/components/settings-view.js';

test('settings viewport stays bounded on short terminals', () => {
  assert.equal(getSettingsViewportSize(8), 1);
  assert.equal(getSettingsViewportSize(20), 5);
  assert.equal(getSettingsViewportSize(24), 9);
});

test('settings viewport never exceeds the field count', () => {
  assert.equal(getSettingsViewportSize(40), 24);
  assert.equal(getSettingsViewportSize(80), 24);
});
