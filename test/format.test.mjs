import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetText } from '../src/format.mjs';

const now = Date.parse('2026-11-10T08:00:00Z');
test('short windows count down in hours and minutes', () => {
  assert.equal(resetText('2026-11-10T10:16:00Z', now), 'resets in 2h 16m');
  assert.equal(resetText('2026-11-10T08:45:00Z', now), 'resets in 45m');
});
test('past or missing times', () => {
  assert.equal(resetText('2026-11-10T07:00:00Z', now), 'resets now');
  assert.equal(resetText(null, now), '');
});
test('long windows show the day', () => {
  assert.match(resetText('2026-11-13T09:00:00Z', now), /^resets \w+/);
});
