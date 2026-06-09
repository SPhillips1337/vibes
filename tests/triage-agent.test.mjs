import assert from 'node:assert/strict';
import test from 'node:test';

import { TriageAgent } from '../dist/agent/triage-agent.js';

test('zero-total context readings do not trigger live steering', () => {
  const triage = new TriageAgent(true);
  triage.reset('task');
  triage.recordContextReading('task', 0, 0);
  triage.recordContextReading('task', 1, 0);

  triage.checkLive('task');

  assert.equal(triage.pendingSteerMessage, '');
});

test('zero-total readings are excluded from average pressure', async () => {
  const triage = new TriageAgent(true);
  triage.reset('task');
  triage.recordContextReading('task', 1, 0);
  triage.recordContextReading('task', 95, 100);
  triage.recordContextReading('task', 95, 100);
  triage.recordContextReading('task', 95, 100);

  const action = await triage.analyzeTimeBased();

  assert.deepEqual(action, { type: 'compress', reason: 'Context at 95%' });
});
