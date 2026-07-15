// tests/pomodoro.test.mjs — v0.3.0 番茄钟状态机测试
import { createPomodoro, nextPhase, fmt, PHASES } from '../lib/pomodoro.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.error('  ✗', name, '\n    ', e.message); fail++; }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

console.log('nextPhase()');
t('work → break', () => eq(nextPhase('work'), 'break'));
t('break → work', () => eq(nextPhase('break'), 'work'));
t('idle → work', () => eq(nextPhase('idle'), 'work'));

console.log('fmt()');
t('0 → 00:00', () => eq(fmt(0), '00:00'));
t('65s → 01:05', () => eq(fmt(65_000), '01:05'));
t('25min → 25:00', () => eq(fmt(25 * 60_000), '25:00'));
t('负数 → 00:00', () => eq(fmt(-100), '00:00'));

console.log('createPomodoro()');
t('初始状态 idle', () => {
  const p = createPomodoro();
  eq(p.snapshot().phase, 'idle');
  eq(p.snapshot().cycleCount, 0);
});

t('start(work) 切换到 work', () => {
  const p = createPomodoro({ workMinutes: 25 });
  p.start('work');
  eq(p.snapshot().phase, 'work');
  p.stop();
});

t('pause/resume 切换 phase', () => {
  const p = createPomodoro({ workMinutes: 25 });
  p.start('work');
  p.pause();
  eq(p.snapshot().phase, 'paused');
  p.resume();
  eq(p.snapshot().phase, 'work');
  p.stop();
});

t('stop 归零', () => {
  const p = createPomodoro();
  p.start('work');
  p.stop();
  eq(p.snapshot().phase, 'idle');
});

t('updateConfig 修改时长', () => {
  const p = createPomodoro({ workMinutes: 25, breakMinutes: 5 });
  p.updateConfig({ workMinutes: 45, breakMinutes: 10 });
  eq(p.snapshot().workMinutes, 45);
  eq(p.snapshot().breakMinutes, 10);
});

t('PHASES 元数据完整', () => {
  ['idle', 'work', 'break', 'paused'].forEach((k) => {
    if (!PHASES[k]) throw new Error(`missing ${k}`);
  });
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
