const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUsage } = require('../electron/control.cjs');

test('turns the SDK /usage data into the panel model', () => {
  const u = normalizeUsage({
    subscription_type: 'team', rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 27.4, resets_at: '2026-11-10T07:00:00Z' },
      seven_day: { utilization: 47, resets_at: '2026-11-10T22:00:00Z' },
      seven_day_opus: { utilization: 12, resets_at: null },
      model_scoped: [{ display_name: 'Fable', utilization: 0, resets_at: '2026-11-10T22:00:00Z' }, { display_name: 'Opus', utilization: 99, resets_at: null }],
      extra_usage: { is_enabled: false },
    },
    behaviors: { week: { request_count: 10, session_count: 3, recommendations: [{ key: 'long_context', pct: 72, title: 'Start fresh', detail: 'run /clear' }] } },
  });
  assert.equal(u.plan, 'team');
  assert.deepEqual(u.session, { pct: 27, resetsAt: '2026-11-10T07:00:00Z' });
  assert.equal(u.weekly.pct, 47);
  assert.deepEqual(u.weeklyModels.map(m => m.name), ['Opus', 'Fable']);   // no duplicate Opus
  assert.equal(u.extra, null);
  assert.deepEqual(u.tips, [{ title: 'Start fresh', detail: 'run /clear', pct: 72 }]);
});

test('API-key logins have no plan limits', () => {
  const u = normalizeUsage({ subscription_type: null, rate_limits_available: false, rate_limits: null, behaviors: null });
  assert.equal(u.available, false);
  assert.equal(u.session, null);
  assert.deepEqual(u.weeklyModels, []);
  assert.deepEqual(u.tips, []);
});
