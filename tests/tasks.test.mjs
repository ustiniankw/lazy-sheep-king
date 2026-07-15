// tests/tasks.test.mjs — v0.3.3 Storage 测试（多任务 / 设置 / dailyLog / profile / sync 开关）
const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
};
globalThis.chrome = undefined;

const { Storage } = await import('../lib/storage.js');
const { todayKey } = await import('../lib/calendar.js');

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log('  ✓', name);
    pass += 1;
  } catch (error) {
    console.error('  ✗', name, '\n    ', error.message);
    fail += 1;
  }
}
function eq(actual, expected, message = '') {
  if (actual !== expected) throw new Error(`${message} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function fixture(id, goal, steps = 3, currentIndex = 0) {
  return {
    id,
    goal,
    createdAt: Date.now(),
    currentIndex,
    steps: Array.from({ length: steps }, (_, index) => ({ title: `step ${index}`, done: false, skipped: false })),
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
  eq((await Storage.getTasks()).length, 2);
});

await t('切换 active', async () => {
  await Storage.setActiveTaskId('t1');
  eq((await Storage.getActiveTask()).id, 't1');
});

await t('deleteTask 删除 active 后会清空 activeId（不自动切换）', async () => {
  await Storage.deleteTask('t1');
  eq((await Storage.getTasks()).length, 1);
  eq(await Storage.getActiveTaskId(), null);
});

await t('clearCurrentTask 移除当前 active', async () => {
  await Storage.setActiveTaskId('t2');
  await Storage.clearCurrentTask();
  eq((await Storage.getTasks()).length, 0);
  eq(await Storage.getActiveTaskId(), null);
});

console.log('Storage · 设置默认值');

await t('默认 pomodoro 25/5', async () => {
  const settings = await Storage.getSettings();
  eq(settings.pomodoro.workMinutes, 25);
  eq(settings.pomodoro.breakMinutes, 5);
  eq(settings.pomodoro.autoStartNext, true);
});

await t('setSettings 深合并 llm / stepTimer / pomodoro', async () => {
  await Storage.setSettings({ llm: { enabled: true }, pomodoro: { workMinutes: 50 }, stepTimer: { autoStart: true } });
  const settings = await Storage.getSettings();
  eq(settings.llm.enabled, true);
  eq(settings.pomodoro.workMinutes, 50);
  eq(settings.pomodoro.breakMinutes, 5);
  eq(settings.stepTimer.autoStart, true);
  eq(settings.stepTimer.endSound, true);
});

console.log('Storage · dailyLog / recentBreakdowns / profile / sync');

await t('addStepCompleted + addTaskCompleted 累加当日 dailyLog', async () => {
  await Storage.setStats({ totalTasksCompleted: 0, totalStepsCompleted: 0, foodStock: 0, petLevel: 1, petExp: 0, dailyLog: {} });
  await Storage.addStepCompleted({ food: 3 });
  await Storage.addTaskCompleted({ food: 2, exp: 1 });
  const stats = await Storage.getStats();
  eq(JSON.stringify(stats.dailyLog[todayKey()]), JSON.stringify({ steps: 1, tasks: 1, food: 5 }));
});

await t('rememberRecentBreakdown 会去重并保留 skeleton', async () => {
  await Storage.setRecentBreakdowns([]);
  await Storage.rememberRecentBreakdown({ normalized: '写周报', intent: 'write.report', stepsSkeleton: [{ title: '打开模板', estMinutes: 3 }] });
  await Storage.rememberRecentBreakdown({ normalized: '写周报', intent: 'write.report', stepsSkeleton: [{ title: '新 skeleton', estMinutes: 4 }] });
  const list = await Storage.getRecentBreakdowns();
  eq(list.length, 1);
  eq(list[0].stepsSkeleton[0].title, '新 skeleton');
});

await t('profile 可读写', async () => {
  await Storage.setProfile({ userId: 'usr_demo', displayName: '测试羊', createdAt: 123, deviceLabel: 'Web' });
  const profile = await Storage.getProfile();
  eq(profile.userId, 'usr_demo');
  eq(profile.displayName, '测试羊');
});

await t('syncEnabled 在无 chrome.sync 时可安全设置', async () => {
  eq(await Storage.getSyncEnabled(), false);
  eq(await Storage.setSyncEnabled(true), false);
  eq(await Storage.getSyncEnabled(), true);
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
