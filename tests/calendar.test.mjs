// tests/calendar.test.mjs — v0.3.2 · 完成日历打卡图纯函数测试
import assert from 'node:assert';
import { todayKey, daysAgoKey, buildHeatmap, summarize } from '../lib/calendar.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.error('  ✗', name, '\n    ', e.message); fail++; }
}

console.log('calendar · todayKey / daysAgoKey');

t('todayKey 使用本地日期补零', () => {
  const d = new Date(2026, 0, 5); // 2026-01-05 本地
  assert.strictEqual(todayKey(d), '2026-01-05');
});

t('daysAgoKey(0) === todayKey', () => {
  const base = new Date(2026, 6, 15);
  assert.strictEqual(daysAgoKey(0, base), '2026-07-15');
});

t('daysAgoKey 跨月回退', () => {
  const base = new Date(2026, 6, 2); // 2026-07-02
  assert.strictEqual(daysAgoKey(5, base), '2026-06-27');
});

console.log('calendar · buildHeatmap');

t('buildHeatmap 返回精确长度', () => {
  const base = new Date(2026, 6, 15);
  assert.strictEqual(buildHeatmap({}, 30, base).length, 30);
  assert.strictEqual(buildHeatmap({}, 90, base).length, 90);
});

t('buildHeatmap 日期升序、结尾为今天', () => {
  const base = new Date(2026, 6, 15);
  const cells = buildHeatmap({}, 3, base);
  assert.deepStrictEqual(cells.map((c) => c.date), ['2026-07-13', '2026-07-14', '2026-07-15']);
});

t('buildHeatmap level 映射 0/1/3/6/10 → 0/1/2/3/4', () => {
  const base = new Date(2026, 6, 15);
  const log = {
    '2026-07-11': { steps: 0, tasks: 0, food: 0 },
    '2026-07-12': { steps: 1, tasks: 0, food: 1 },
    '2026-07-13': { steps: 3, tasks: 1, food: 3 },
    '2026-07-14': { steps: 6, tasks: 1, food: 6 },
    '2026-07-15': { steps: 10, tasks: 2, food: 12 },
  };
  const cells = buildHeatmap(log, 5, base);
  assert.deepStrictEqual(cells.map((c) => c.level), [0, 1, 2, 3, 4]);
  // 数据被正确保留
  assert.strictEqual(cells[4].food, 12);
  assert.strictEqual(cells[4].tasks, 2);
});

console.log('calendar · summarize');

t('summarize 总计 & activeDays', () => {
  const base = new Date(2026, 6, 15);
  const log = {
    '2026-07-13': { steps: 2, tasks: 1, food: 4 },
    '2026-07-14': { steps: 3, tasks: 0, food: 3 },
    '2026-07-15': { steps: 1, tasks: 1, food: 2 },
  };
  const s = summarize(log, 30, base);
  assert.strictEqual(s.totalSteps, 6);
  assert.strictEqual(s.totalTasks, 2);
  assert.strictEqual(s.totalFood, 9);
  assert.strictEqual(s.activeDays, 3);
});

t('summarize currentStreak 以今天结尾', () => {
  const base = new Date(2026, 6, 15);
  const log = {
    '2026-07-13': { steps: 1 },
    '2026-07-14': { steps: 2 },
    '2026-07-15': { steps: 3 },
  };
  const s = summarize(log, 30, base);
  assert.strictEqual(s.currentStreak, 3);
});

t('summarize 今天没打卡 → currentStreak 0', () => {
  const base = new Date(2026, 6, 15);
  const log = {
    '2026-07-13': { steps: 1 },
    '2026-07-14': { steps: 2 },
  };
  const s = summarize(log, 30, base);
  assert.strictEqual(s.currentStreak, 0);
});

t('summarize longestStreak 含 gap 情形', () => {
  const base = new Date(2026, 6, 15);
  const log = {
    '2026-07-09': { steps: 1 },
    '2026-07-10': { steps: 1 },
    '2026-07-11': { steps: 1 }, // 3 连
    // 07-12 gap
    '2026-07-13': { steps: 1 },
    '2026-07-14': { steps: 1 }, // 只有 2 连
    // 07-15 gap（今天没打卡）
  };
  const s = summarize(log, 30, base);
  assert.strictEqual(s.longestStreak, 3);
  assert.strictEqual(s.currentStreak, 0);
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
