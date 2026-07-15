// tests/storage_ns.test.mjs — v0.3.5 多账号命名空间 & 旧数据迁移测试
const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
};
globalThis.chrome = undefined;

// 预置一份"旧版未加前缀"的数据，模拟 v0.3.4 用户升级
mem.set('lsk_profile_v1', JSON.stringify({ userId: 'usr_legacy001', displayName: '老用户', createdAt: 111, deviceLabel: 'Mac' }));
mem.set('lsk_tasks_v1', JSON.stringify([{ id: 'legacy-task', goal: '旧任务不能丢', currentIndex: 0, steps: [{ title: 'a', done: false, skipped: false }] }]));
mem.set('lsk_stats_v1', JSON.stringify({ totalStepsCompleted: 42, totalTasksCompleted: 7, foodStock: 5, petLevel: 3, petExp: 1, lastActiveAt: 999, dailyLog: {} }));

const { Storage } = await import('../lib/storage.js');

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
function ok(condition, message = '') {
  if (!condition) throw new Error(message || 'expected truthy');
}

console.log('Storage · 命名空间迁移');

await t('首次读取会迁移旧数据且不丢失', async () => {
  const tasks = await Storage.getTasks();
  eq(tasks.length, 1);
  eq(tasks[0].id, 'legacy-task');
  const stats = await Storage.getStats();
  eq(stats.totalStepsCompleted, 42);
  const profile = await Storage.getProfile();
  eq(profile.userId, 'usr_legacy001');
});

await t('迁移后 _migrated_035 标记被置位', async () => {
  const flag = await Storage.getGlobal('_migrated_035');
  eq(flag, true);
});

await t('当前账号 key 为 guest:${legacyUserId}', async () => {
  eq(Storage.getCurrentAccountKey(), 'guest:usr_legacy001');
});

await t('旧数据已写入命名空间物理键', async () => {
  const physical = mem.get('lsk:guest:usr_legacy001:lsk_tasks_v1');
  ok(physical, '应存在命名空间物理键');
  ok(physical.includes('legacy-task'), '命名空间键应包含旧任务');
});

console.log('\nStorage · 多账号隔离');

await t('两个账号的 tasks / stats 相互隔离', async () => {
  await Storage.switchAccount('p:userA');
  await Storage.setTasks([{ id: 'a1', goal: 'A 的任务', currentIndex: 0, steps: [{ title: 's', done: false, skipped: false }] }]);
  await Storage.setStats({ totalStepsCompleted: 100 });

  await Storage.switchAccount('gh:userB');
  await Storage.setTasks([{ id: 'b1', goal: 'B 的任务', currentIndex: 0, steps: [{ title: 's', done: false, skipped: false }] }]);
  await Storage.setStats({ totalStepsCompleted: 5 });

  const bTasks = await Storage.getTasks();
  eq(bTasks.length, 1);
  eq(bTasks[0].id, 'b1');
  eq((await Storage.getStats()).totalStepsCompleted, 5);

  await Storage.switchAccount('p:userA');
  const aTasks = await Storage.getTasks();
  eq(aTasks.length, 1);
  eq(aTasks[0].id, 'a1');
  eq((await Storage.getStats()).totalStepsCompleted, 100);
});

await t('读取未知账号的键返回默认值（不崩溃）', async () => {
  await Storage.switchAccount('p:brand-new-user');
  const tasks = await Storage.getTasks();
  eq(Array.isArray(tasks), true);
  eq(tasks.length, 0);
  const history = await Storage.getHistory();
  eq(history.length, 0);
  const stats = await Storage.getStats();
  eq(stats.totalStepsCompleted, 0);
  eq(stats.petLevel, 1);
});

await t('copyAccountData 平滑升级：guest → passphrase 携带数据', async () => {
  await Storage.switchAccount('guest:upgrade-me');
  await Storage.setTasks([{ id: 'keep', goal: '升级也要在', currentIndex: 0, steps: [{ title: 's', done: false, skipped: false }] }]);
  await Storage.copyAccountData('guest:upgrade-me', 'p:upgrade-me');
  await Storage.switchAccount('p:upgrade-me');
  const tasks = await Storage.getTasks();
  eq(tasks.length, 1);
  eq(tasks[0].id, 'keep');
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
