// tests/step_timer.test.mjs — v0.3.1
import { createCountdown, fmt, calcStepReward, calcTaskCompletionBonus } from '../lib/step_timer.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.error('  ✗', name, '\n    ', e.message); fail++; }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

console.log('fmt()');
t('0 → 00:00', () => eq(fmt(0), '00:00'));
t('65s → 01:05', () => eq(fmt(65_000), '01:05'));
t('负数 → 00:00', () => eq(fmt(-100), '00:00'));

console.log('createCountdown()');
t('初始 idle', () => {
  const c = createCountdown();
  eq(c.snapshot().phase, 'idle');
});
t('start(3) 切 running', () => {
  const c = createCountdown();
  c.start(3);
  eq(c.snapshot().phase, 'running');
  c.stop();
});
t('pause/resume', () => {
  const c = createCountdown();
  c.start(3);
  c.pause();
  eq(c.snapshot().phase, 'paused');
  c.resume();
  eq(c.snapshot().phase, 'running');
  c.stop();
});
t('addMinutes 延长', () => {
  const c = createCountdown();
  c.start(3);
  const before = c.snapshot().totalMs;
  c.addMinutes(2);
  const after = c.snapshot().totalMs;
  if (after - before !== 2 * 60_000) throw new Error('totalMs should grow by 2 min');
  c.stop();
});

console.log('calcStepReward()');
t('跳过 → 0 养料', () => {
  const r = calcStepReward({ estMinutes: 3, actualMs: 0, skipped: true });
  eq(r.food, 0); eq(r.tag, 'skip');
});
t('未计时 → base', () => {
  const r = calcStepReward({ estMinutes: 5, actualMs: 0 });
  eq(r.food, 5); eq(r.tag, 'no-timer');
});
t('准时 → base × 1.5', () => {
  // 5min plan, 4min real = on-time
  const r = calcStepReward({ estMinutes: 5, actualMs: 4 * 60_000 });
  eq(r.food, 5 + Math.ceil(5 * 0.5)); // 8
  eq(r.tag, 'on-time');
});
t('磨蹭 (超过 2x) → base 无奖励', () => {
  const r = calcStepReward({ estMinutes: 3, actualMs: 10 * 60_000 });
  eq(r.food, 3); eq(r.tag, 'over-time');
});
t('轻微超时 (1x~2x) → base 无奖励', () => {
  const r = calcStepReward({ estMinutes: 3, actualMs: 4 * 60_000 });
  eq(r.food, 3); eq(r.tag, 'normal');
});
t('estMinutes < 1 也保底 1', () => {
  const r = calcStepReward({ estMinutes: 0.5, actualMs: 0 });
  if (r.food < 1) throw new Error('should floor to 1');
});

console.log('calcTaskCompletionBonus()');
t('sum × 0.2 向上取整', () => {
  const task = { steps: [{ estMinutes: 3 }, { estMinutes: 5 }, { estMinutes: 2 }] };
  const b = calcTaskCompletionBonus(task);
  // total = 10, bonus = ceil(10*0.2) = 2
  eq(b.food, 2);
});
t('空 task → 0', () => {
  const b = calcTaskCompletionBonus({ steps: [] });
  eq(b.food, 0);
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
