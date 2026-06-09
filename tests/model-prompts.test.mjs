import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getModelSpecificPrompt,
  isGemma12BModel,
} from '../dist/agent/model-prompts.js';

test('detects common Gemma 12B model identifiers', () => {
  assert.equal(isGemma12BModel('google/gemma-4-12b-qat'), true);
  assert.equal(isGemma12BModel('gemma-3-12b-it'), true);
  assert.equal(isGemma12BModel('google/gemma-4-e2b'), false);
  assert.equal(isGemma12BModel('qwen3.5-12b'), false);
});

test('does not inject instructions for other models', () => {
  assert.equal(getModelSpecificPrompt('qwen3.5-2b', 'executor'), '');
});

test('keeps executor instructions compatible with Vibes tools', () => {
  const prompt = getModelSpecificPrompt('google/gemma-4-12b-qat', 'executor');

  assert.match(prompt, /Prefer the native Vibes function tools/);
  assert.match(prompt, /Do not emit unified diffs/);
  assert.doesNotMatch(prompt, /Antigravity IDE/);
});

test('preserves strict structured-output contracts', () => {
  const planner = getModelSpecificPrompt('gemma-4-12b', 'planner');
  const reviewer = getModelSpecificPrompt('gemma-4-12b', 'reviewer');
  const triage = getModelSpecificPrompt('gemma-4-12b', 'triage');

  assert.match(planner, /exactly one raw JSON mission-plan object/);
  assert.match(reviewer, /exactly one raw JSON review object/);
  assert.match(triage, /call that tool with schema-valid arguments/);
  assert.match(triage, /exactly one raw JSON object/);
});
