// tests/tasks.test.mjs — v0.3.0 多任务并存 Storage 测试
// mock localStorage 为纯内存 map
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
// 显式关闭 chrome mock
globalThis.chrome = undefined;

const { Storage } = await import('../lib/storage.js');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.error('  ✗', name, '\n    ', e.message); fail++; }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

function fixture(id, goal, steps = 3, currentIndex = 0) {
  return {
    id, goal, createdAt: Date.now(),
    currentIndex,
    steps: Array.from({ length: steps }, (_, i) => ({ title: `step ${i}`, done: false, skipped: false })),
  };
}

console.log('Storage · 多任务 API');

await t('初始 getTasks 为空数组', async () => {
  eq((await Storage.getTasks()).length, 0);
});

await t('saveTask 新增', async () => {
  await Storage.saveTask(fixture('t1', '写周报'));
  const list = await Storage.getTasks();
  eq(list.length, 1);
  eq(list[0].id, 't1');
});

await t('saveTask 更新（同 id）', async () => {
  const t1 = (await Storage.getTasks())[0];
  t1.goal = '写周报（修改）';
  await Storage.saveTask(t1);
  const list = await Storage.getTasks();
  eq(list.length, 1);
  eq(list[0].goal, '写周报（修改）');
});

await t('setCurrentTask 会同时设为 active', async () => {
  await Storage.setCurrentTask(fixture('t2', '打扫桌面'));
  eq(await Storage.getActiveTaskId(), 't2');
  eq((await Storage.getActiveTask()).goal, '打扫桌面');
});

await t('多任务并存：可拿到 2 条', async () => {
  const list = await Storage.getTasks();
  eq(list.length, 2);
});

await t('切换 active', async () => {
  await Storage.setActiveTaskId('t1');
  eq((await Storage.getActiveTask()).id, 't1');
});

await t('deleteTask 删除并自动挑下一个 active', async () => {
  await Storage.deleteTask('t1');
  const list = await Storage.getTasks();
  eq(list.length, 1);
  eq((await Storage.getActiveTask()).id, 't2');
});

await t('clearCurrentTask 移除当前 active', async () => {
  await Storage.clearCurrentTask();
  eq((await Storage.getTasks()).length, 0);
  eq(await Storage.getActiveTaskId(), null);
});

console.log('Storage · 番茄钟 settings 默认值');

await t('默认 pomodoro 25/5', async () => {
  const s = await Storage.getSettings();
  eq(s.pomodoro.workMinutes, 25);
  eq(s.pomodoro.breakMinutes, 5);
  eq(s.pomodoro.autoStartNext, true);
});

await t('setSettings 深合并 pomodoro', async () => {
  await Storage.setSettings({ pomodoro: { workMinutes: 50 } });
  const s = await Storage.getSettings();
  eq(s.pomodoro.workMinutes, 50);
  eq(s.pomodoro.breakMinutes, 5);
});

console.log('Storage · v0.3.2 dailyLog 打卡');

await t('addStepCompleted + addTaskCompleted 累加当日 dailyLog', async () => {
  const { todayKey } = await import('../lib/calendar.js');
  await Storage.addStepCompleted({ food: 3 });
  await Storage.addTaskCompleted({ food: 2, exp: 1 });
  const stats = await Storage.getStats();
  const today = todayKey();
  eq(JSON.stringify(stats.dailyLog[today]), JSON.stringify({ steps: 1, tasks: 1, food: 5 }));
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
