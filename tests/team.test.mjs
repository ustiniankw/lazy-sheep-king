// tests/team.test.mjs — v0.3.4 组队模式 / 隐私模式 / 存储迁移
const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
};
globalThis.chrome = undefined;

const { Storage } = await import('../lib/storage.js');
const { PRIVACY, newTeamCode, buildMyMemberSnapshot, mergeTeamState, makePoke } = await import('../lib/team.js');

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
function ok(condition, message) {
  if (!condition) throw new Error(message);
}

function task(goal = '写周报', total = 5, done = 2) {
  return {
    id: 'task_demo',
    goal,
    currentIndex: done,
    steps: Array.from({ length: total }, (_, index) => ({ title: `step ${index}`, done: index < done, skipped: false })),
  };
}

console.log('team.js · code / snapshot / merge');

await t('newTeamCode 长度为 6', async () => {
  eq(newTeamCode().length, 6);
});

await t('newTeamCode 为大写十六进制', async () => {
  ok(/^[0-9A-F]{6}$/.test(newTeamCode()), '格式应为 6 位大写十六进制');
});

await t('连续生成多个 team code 基本不重复', async () => {
  const set = new Set(Array.from({ length: 20 }, () => newTeamCode()));
  eq(set.size, 20);
});

await t('public 隐私会显示真实标题', async () => {
  const snapshot = buildMyMemberSnapshot({
    profile: { userId: 'usr_1', displayName: '小羊', deviceLabel: 'Web' },
    stats: { dailyLog: { '2099-01-01': { steps: 3 } } },
    dailyLog: {},
    activeTask: task('准备评审会', 5, 2),
    privacy: PRIVACY.PUBLIC,
  });
  eq(snapshot.activeTaskView.title, '准备评审会');
});

await t('public 隐私保留进度文本', async () => {
  const snapshot = buildMyMemberSnapshot({
    profile: { userId: 'usr_1', displayName: '小羊', deviceLabel: 'Web' },
    stats: { dailyLog: {} },
    activeTask: task('准备评审会', 5, 2),
    privacy: PRIVACY.PUBLIC,
  });
  eq(snapshot.activeTaskView.progressText, '2/5');
});

await t('title-hidden 会隐藏真实标题', async () => {
  const snapshot = buildMyMemberSnapshot({
    profile: { userId: 'usr_1', displayName: '小羊', deviceLabel: 'Web' },
    stats: { dailyLog: {} },
    activeTask: task('准备评审会', 5, 3),
    privacy: PRIVACY.TITLE_HIDDEN,
  });
  eq(snapshot.activeTaskView.title, '🔒 私密任务');
});

await t('title-hidden 仍保留步数进度', async () => {
  const snapshot = buildMyMemberSnapshot({
    profile: { userId: 'usr_1', displayName: '小羊', deviceLabel: 'Web' },
    stats: { dailyLog: {} },
    activeTask: task('准备评审会', 5, 3),
    privacy: PRIVACY.TITLE_HIDDEN,
  });
  eq(snapshot.activeTaskView.label, '🔒 私密任务 · 3/5');
});

await t('full-private 会完全隐藏标题', async () => {
  const snapshot = buildMyMemberSnapshot({
    profile: { userId: 'usr_1', displayName: '小羊', deviceLabel: 'Web' },
    stats: { dailyLog: {} },
    activeTask: task('准备评审会', 5, 3),
    privacy: PRIVACY.FULL_PRIVATE,
  });
  eq(snapshot.activeTaskView.title, '🔒 完全私密');
});

await t('full-private 只暴露百分比', async () => {
  const snapshot = buildMyMemberSnapshot({
    profile: { userId: 'usr_1', displayName: '小羊', deviceLabel: 'Web' },
    stats: { dailyLog: {} },
    activeTask: task('准备评审会', 5, 3),
    privacy: PRIVACY.FULL_PRIVATE,
  });
  eq(snapshot.activeTaskView.progressText, '60%');
});

await t('full-private label 不泄漏原标题', async () => {
  const snapshot = buildMyMemberSnapshot({
    profile: { userId: 'usr_1', displayName: '小羊', deviceLabel: 'Web' },
    stats: { dailyLog: {} },
    activeTask: task('准备评审会', 5, 3),
    privacy: PRIVACY.FULL_PRIVATE,
  });
  ok(!snapshot.activeTaskView.label.includes('准备评审会'), '不应泄漏原标题');
});

await t('mergeTeamState 成员按 updatedAt 取新', async () => {
  const merged = mergeTeamState(
    { code: 'ABC123', members: { u1: { userId: 'u1', name: '旧', updatedAt: 10 } }, pokes: [], updatedAt: 10 },
    { code: 'ABC123', members: { u1: { userId: 'u1', name: '新', updatedAt: 20 } }, pokes: [], updatedAt: 20 },
  );
  eq(merged.members.u1.name, '新');
});

await t('mergeTeamState 较旧成员不会覆盖较新成员', async () => {
  const merged = mergeTeamState(
    { code: 'ABC123', members: { u1: { userId: 'u1', name: '新', updatedAt: 30 } }, pokes: [], updatedAt: 30 },
    { code: 'ABC123', members: { u1: { userId: 'u1', name: '旧', updatedAt: 20 } }, pokes: [], updatedAt: 20 },
  );
  eq(merged.members.u1.name, '新');
});

await t('mergeTeamState 会把不同成员都保留下来', async () => {
  const merged = mergeTeamState(
    { code: 'ABC123', members: { u1: { userId: 'u1', name: 'A', updatedAt: 10 } }, pokes: [], updatedAt: 10 },
    { code: 'ABC123', members: { u2: { userId: 'u2', name: 'B', updatedAt: 20 } }, pokes: [], updatedAt: 20 },
  );
  eq(Object.keys(merged.members).length, 2);
});

await t('mergeTeamState 会按 pokeId 去重', async () => {
  const merged = mergeTeamState(
    { code: 'ABC123', members: {}, pokes: [{ pokeId: 'p1', from: 'a', to: 'b', ts: 1, read: false }], updatedAt: 1 },
    { code: 'ABC123', members: {}, pokes: [{ pokeId: 'p1', from: 'a', to: 'b', ts: 2, read: false }], updatedAt: 2 },
  );
  eq(merged.pokes.length, 1);
});

await t('mergeTeamState 去重时会保留已读状态', async () => {
  const merged = mergeTeamState(
    { code: 'ABC123', members: {}, pokes: [{ pokeId: 'p1', from: 'a', to: 'b', ts: 1, read: true }], updatedAt: 1 },
    { code: 'ABC123', members: {}, pokes: [{ pokeId: 'p1', from: 'a', to: 'b', ts: 2, read: false }], updatedAt: 2 },
  );
  eq(merged.pokes[0].read, true);
});

await t('makePoke 会生成唯一 id', async () => {
  const a = makePoke({ from: 'u1', to: 'u2', message: '冲呀' });
  const b = makePoke({ from: 'u1', to: 'u2', message: '冲呀' });
  ok(a.pokeId !== b.pokeId, 'pokeId 应唯一');
});

await t('makePoke 默认 read=false', async () => {
  eq(makePoke({ from: 'u1', to: 'u2', message: '冲呀' }).read, false);
});

console.log('Storage · team keys / privacy migration');

await t('旧任务缺失 privacy 时会按 settings.team.defaultPrivacy 自动补齐', async () => {
  await Storage.resetAllLocalData();
  await Storage.setSettings({ team: { defaultPrivacy: PRIVACY.TITLE_HIDDEN } });
  mem.set(Storage.KEYS.TASKS, JSON.stringify([{ id: 'legacy', goal: '旧任务', currentIndex: 0, steps: [{ title: 'a', done: false, skipped: false }] }]));
  const tasks = await Storage.getTasks();
  eq(tasks[0].privacy, PRIVACY.TITLE_HIDDEN);
});

await t('setTasks 会保留显式设置的 privacy', async () => {
  await Storage.setTasks([{ id: 't1', goal: '任务', privacy: PRIVACY.FULL_PRIVATE, currentIndex: 0, steps: [{ title: 'a', done: false, skipped: false }] }]);
  const tasks = await Storage.getTasks();
  eq(tasks[0].privacy, PRIVACY.FULL_PRIVATE);
});

await t('teamSelf / teamState helper 可读写', async () => {
  await Storage.setTeamSelf({ teamCode: 'A1B2C3', joinedAt: 123, syncUrl: 'https://example.com/team.json' });
  await Storage.setTeamState({ code: 'A1B2C3', members: { u1: { userId: 'u1', name: '小羊', updatedAt: 1 } }, pokes: [], updatedAt: 1 });
  const teamSelf = await Storage.getTeamSelf();
  const teamState = await Storage.getTeamState();
  eq(teamSelf.teamCode, 'A1B2C3');
  eq(teamState.code, 'A1B2C3');
});

await t('pushPokes 会把新 poke 合并进 teamState', async () => {
  await Storage.setTeamState({ code: 'A1B2C3', members: {}, pokes: [], updatedAt: 1 });
  await Storage.pushPokes({ pokeId: 'px', from: 'u1', to: 'u2', ts: 1, read: false });
  const teamState = await Storage.getTeamState();
  eq(teamState.pokes.length, 1);
});

console.log(`\nresult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
