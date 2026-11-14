// Animated exercise drawings used in the exercise plan.  Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { ART_IDS, exerciseArt } from '../js/exerciseArt.js';
import { EXERCISES } from '../js/exercises.js';

test('every exercise in the library has its own animated drawing', () => {
  for (const id of Object.keys(EXERCISES)) {
    assert.ok(ART_IDS.includes(id), `no drawing for ${id}`);
    assert.match(exerciseArt(id), /class="art__move|class="art__pose/, `${id} has no moving part`);
  }
});

test('labelled when used alone, hidden from screen readers when next to the name; special characters are HTML-escaped, not stripped', () => {
  assert.match(exerciseArt('mini-squat', { label: 'Mini squat <shown>' }), /role="img" aria-label="Mini squat &lt;shown&gt;"/);
  assert.match(exerciseArt('shoulder-abduction'), /aria-hidden="true"/);
});

test('uses theme colours only (no hard-coded colours)', () => {
  for (const id of ART_IDS) assert.doesNotMatch(exerciseArt(id), /#[0-9a-f]{3,6}\b/i, id);
});

test('an unknown exercise still gets a figure', () => {
  assert.match(exerciseArt('not-an-exercise'), /<circle/);
});
